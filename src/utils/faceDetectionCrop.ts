import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

export type AutoCropMethod = 'A' | 'B' | 'A2' | 'C';

export type Point2D = [number, number];
export type QuadCorners = [Point2D, Point2D, Point2D, Point2D]; // [tl, tr, br, bl]

export interface DetectedFaceBox {
  id: number;
  /** Bounding box in original image pixel coordinates */
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  /** Keypoints in original image pixel coordinates (eyes, nose, mouth, ears) */
  keypoints: Array<{ x: number; y: number; name?: string }>;
  /** Suggested head tilt angle in degrees to level the eyes horizontally */
  suggestedTiltDeg: number;
  /** Optional detected outer boundary of a physical 3x4 photo print surrounding this face */
  photoCardRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
    angleDeg: number;
    method: AutoCropMethod;
    corners?: QuadCorners;
  };
}

export interface CropTransformConfig {
  /** Center of the crop box in original image pixel coordinates */
  centerX: number;
  centerY: number;
  /** Zoom scale factor relative to baseCropHeight (1.0 = auto-detected 3x4 framing) */
  scale: number;
  /** Base crop height in original image pixels before scale */
  baseCropHeight: number;
  /** Rotation in degrees to deskew / straighten the photo */
  rotationDeg: number;
  /** Horizontal mirror */
  flipH: boolean;
  /** Brightness percentage (100 = normal) */
  brightness: number;
  /** Contrast percentage (100 = normal) */
  contrast: number;
  /** Mild sharpening / beautification toggle */
  sharpen: boolean;
  /** Aspect ratio width / height: default 3/4 (0.75) for 354x472 px @ 300 DPI */
  aspectRatio: number;
  /** Which pipeline stage produced this crop ('A' | 'B' | 'A2' | 'C') */
  methodUsed?: AutoCropMethod;
  /** Human-readable description of the stage that succeeded */
  methodDescription?: string;
  /** True when Method C or low-confidence fallback was used and user should review ("XEM") */
  needsReview?: boolean;
  /** Exact 4 corners [tl, tr, br, bl] in original image pixel coordinates when detected by A/B/A2 */
  quadCorners?: QuadCorners;
  /** Beautification level --muc 0..3 from anh_the.py (default 2) */
  enhanceLevel?: 0 | 1 | 2 | 3;
  /** Whether to remove red stamp overlapping the ID photo (default true, --giu-dau = false) */
  removeRedStamp?: boolean;
  /** Border trim ratio --bo-vien (default 0.012) */
  borderTrimRatio?: number;
  /** Detected red stamp circles [(cx, cy, r)] in original image coordinates */
  detectedStamps?: Array<[number, number, number]>;
  /** Whether red stamp ink was actually removed */
  stampRemoved?: boolean;
  /** Normalized face rect [fx0, fy0, fx1, fy1] in [0..1] of the cropped card for skin tone exposure */
  normalizedFaceInCard?: [number, number, number, number];
  /** Sampled white paper RGB [R, G, B] surrounding the card for white balance */
  surroundingPaperRgb?: [number, number, number] | null;
}

/** Standard 3x4 cm @ 300 DPI dimensions in pixels (from anh_the.py) */
export const OUTPUT_3X4_WIDTH_PX = 354;
export const OUTPUT_3X4_HEIGHT_PX = 472;

// Exact constants from anh_the.py
export const TI_LE = 3 / 4; // rộng / cao
export const DETECT_MAX = 1200; // cạnh dài nhất khi dò tấm ảnh theo nền bàn (px)
export const MAT_RONG = 0.52; // khung dò mặt rộng ~52% bề ngang ảnh thẻ chuẩn
export const MAT_Y = 0.17; // mép trên khung mặt cách đỉnh ảnh ~17% chiều cao
export const MAT_RONG_MIN = 0.30;
export const MAT_RONG_MAX = 0.78;
export const PHONG_CO_MAU = 16.0; // độ đậm màu phông nền tối thiểu để tin ngay ở Cách A
export const MEP_NGUONG = 12.0; // độ dốc sáng-tối tối thiểu cho điểm mép ở Cách A2
export const SO_MAT_THU = 6; // số khuôn mặt ứng viên đem thử
export const DEFAULT_BO_VIEN = 0.012; // tỉ lệ mép cắt bỏ thêm để hết viền trắng

let mediaPipeDetectorPromise: Promise<FaceDetector | null> | null = null;

/**
 * Lazily initializes Google MediaPipe BlazeFace AI detector in browser WASM.
 */
export async function getMediaPipeFaceDetector(): Promise<FaceDetector | null> {
  if (!mediaPipeDetectorPromise) {
    mediaPipeDetectorPromise = (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
        );
        return await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
          },
          runningMode: 'IMAGE',
          minDetectionConfidence: 0.25,
        });
      } catch (err) {
        console.warn('MediaPipe primary CDN failed, trying fallback:', err);
        try {
          const visionFallback = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'
          );
          return await FaceDetector.createFromOptions(visionFallback, {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
            },
            runningMode: 'IMAGE',
            minDetectionConfidence: 0.25,
          });
        } catch (fallbackErr) {
          console.warn('MediaPipe initialization unavailable:', fallbackErr);
          mediaPipeDetectorPromise = null;
          return null;
        }
      }
    })();
  }
  return mediaPipeDetectorPromise;
}

// ============================================================================
// COLOR SPACE & IMAGE PROCESSING PRIMITIVES (OpenCV 8-bit LAB, HSV, Blur, etc.)
// ============================================================================

/**
 * Converts sRGB (0..255) to OpenCV 8-bit CIE LAB:
 * L in [0..255], a in [0..255] (neutral = 128), b in [0..255] (neutral = 128).
 */
function rgbToCvLab(r: number, g: number, b: number): [number, number, number] {
  let sr = r / 255;
  let sg = g / 255;
  let sb = b / 255;

  sr = sr > 0.04045 ? Math.pow((sr + 0.055) / 1.055, 2.4) : sr / 12.92;
  sg = sg > 0.04045 ? Math.pow((sg + 0.055) / 1.055, 2.4) : sg / 12.92;
  sb = sb > 0.04045 ? Math.pow((sb + 0.055) / 1.055, 2.4) : sb / 12.92;

  // D65 reference white
  const x = (sr * 0.4124564 + sg * 0.3575761 + sb * 0.1804375) / 0.95047;
  const y = sr * 0.2126729 + sg * 0.7151522 + sb * 0.0721750;
  const z = (sr * 0.0193339 + sg * 0.1191920 + sb * 0.9503041) / 1.08883;

  const f = (t: number) =>
    t > 0.008856 ? Math.cbrt(t) : 7.787037 * t + 16 / 116;

  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  const Lstar = 116 * fy - 16; // 0..100
  const astar = 500 * (fx - fy); // -127..127
  const bstar = 200 * (fy - fz); // -127..127

  const Lcv = Math.max(0, Math.min(255, (Lstar * 255) / 100));
  const acv = Math.max(0, Math.min(255, astar + 128));
  const bcv = Math.max(0, Math.min(255, bstar + 128));
  return [Lcv, acv, bcv];
}

/**
 * Converts OpenCV 8-bit CIE LAB (L: 0..255, a: 0..255, b: 0..255) back to sRGB (0..255).
 */
function cvLabToRgb(Lcv: number, acv: number, bcv: number): [number, number, number] {
  const Lstar = (Lcv * 100) / 255;
  const astar = acv - 128;
  const bstar = bcv - 128;

  const fy = (Lstar + 16) / 116;
  const fx = astar / 500 + fy;
  const fz = fy - bstar / 200;

  const invF = (t: number) => {
    const t3 = t * t * t;
    return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787037;
  };

  const x = invF(fx) * 0.95047;
  const y = invF(fy);
  const z = invF(fz) * 1.08883;

  let rl = x * 3.2404542 - y * 1.5371385 - z * 0.4985314;
  let gl = -x * 0.9692660 + y * 1.8760108 + z * 0.0415560;
  let bl = x * 0.0556434 - y * 0.2040259 + z * 1.0572252;

  const toSrgb = (c: number) => {
    const v =
      c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  };

  return [toSrgb(rl), toSrgb(gl), toSrgb(bl)];
}

/**
 * Converts RGB (0..255) to OpenCV Hue (0..180).
 */
function rgbToCvHue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h = 0;
  if (max === r) {
    h = ((g - b) / d) % 6;
  } else if (max === g) {
    h = (b - r) / d + 2;
  } else {
    h = (r - g) / d + 4;
  }
  h = h * 60;
  if (h < 0) h += 360;
  return Math.round(h / 2); // 0..180 as in OpenCV uint8 HSV
}

/**
 * Separable 5x5 Gaussian blur on RGBA ImageData, returning Float32 LAB buffer (3 channels per pixel).
 */
function computeBlurredLabBuffer(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  lWeight = 1.0
): Float32Array {
  // 5x5 Gaussian kernel [1, 4, 6, 4, 1] / 16
  const k = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
  const tmp = new Float32Array(w * h * 3);
  const lab = new Float32Array(w * h * 3);

  // Horizontal pass on RGB
  for (let y = 0; y < h; y++) {
    const rowOff = y * w;
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dx = -2; dx <= 2; dx++) {
        const xx = Math.max(0, Math.min(w - 1, x + dx));
        const idx = (rowOff + xx) * 4;
        const kw = k[dx + 2];
        r += rgba[idx] * kw;
        g += rgba[idx + 1] * kw;
        b += rgba[idx + 2] * kw;
      }
      const outIdx = (rowOff + x) * 3;
      tmp[outIdx] = r;
      tmp[outIdx + 1] = g;
      tmp[outIdx + 2] = b;
    }
  }

  // Vertical pass + convert to OpenCV LAB
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = Math.max(0, Math.min(h - 1, y + dy));
        const idx = (yy * w + x) * 3;
        const kw = k[dy + 2];
        r += tmp[idx] * kw;
        g += tmp[idx + 1] * kw;
        b += tmp[idx + 2] * kw;
      }
      const [L, a, bCh] = rgbToCvLab(r, g, b);
      const outIdx = (y * w + x) * 3;
      lab[outIdx] = L * lWeight;
      lab[outIdx + 1] = a;
      lab[outIdx + 2] = bCh;
    }
  }

  return lab;
}

function medianOfArray(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : 0.5 * (s[mid - 1] + s[mid]);
}

function percentileOfArray(arr: number[], q: number): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const pos = ((s.length - 1) * q) / 100;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (base + 1 < s.length) {
    return s[base] + rest * (s[base + 1] - s[base]);
  }
  return s[base];
}

/**
 * Morphological erosion on binary mask (0/1) with box kernel (kw x kh).
 */
function erodeMask(
  mask: Uint8Array,
  w: number,
  h: number,
  kw: number,
  kh: number
): Uint8Array {
  const out = new Uint8Array(w * h);
  const rx = Math.floor(kw / 2);
  const ry = Math.floor(kh / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let allOne = 1;
      for (let dy = -ry; dy <= ry && allOne; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) {
          allOne = 0;
          break;
        }
        const rowOff = yy * w;
        for (let dx = -rx; dx <= rx; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w || mask[rowOff + xx] === 0) {
            allOne = 0;
            break;
          }
        }
      }
      out[y * w + x] = allOne;
    }
  }
  return out;
}

/**
 * Morphological dilation on binary mask (0/1) with box kernel (kw x kh).
 */
function dilateMask(
  mask: Uint8Array,
  w: number,
  h: number,
  kw: number,
  kh: number
): Uint8Array {
  const out = new Uint8Array(w * h);
  const rx = Math.floor(kw / 2);
  const ry = Math.floor(kh / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let anyOne = 0;
      for (let dy = -ry; dy <= ry && !anyOne; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        const rowOff = yy * w;
        for (let dx = -rx; dx <= rx; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && mask[rowOff + xx] !== 0) {
            anyOne = 1;
            break;
          }
        }
      }
      out[y * w + x] = anyOne;
    }
  }
  return out;
}

function morphOpen(
  mask: Uint8Array,
  w: number,
  h: number,
  kw: number,
  kh: number
): Uint8Array {
  return dilateMask(erodeMask(mask, w, h, kw, kh), w, h, kw, kh);
}

function morphClose(
  mask: Uint8Array,
  w: number,
  h: number,
  kw: number,
  kh: number
): Uint8Array {
  return erodeMask(dilateMask(mask, w, h, kw, kh), w, h, kw, kh);
}

interface ComponentStat {
  label: number;
  left: number;
  top: number;
  width: number;
  height: number;
  area: number;
}

/**
 * 8-connected components labeling with bounding box stats (matches cv2.connectedComponentsWithStats).
 */
function connectedComponentsWithStats8(
  mask: Uint8Array,
  w: number,
  h: number
): { labels: Int32Array; stats: ComponentStat[] } {
  const labels = new Int32Array(w * h);
  const stats: ComponentStat[] = [
    { label: 0, left: 0, top: 0, width: w, height: h, area: 0 },
  ];
  const queueX = new Int32Array(w * h);
  const queueY = new Int32Array(w * h);
  let currentLabel = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (mask[idx] === 0 || labels[idx] !== 0) continue;

      currentLabel++;
      labels[idx] = currentLabel;
      let head = 0;
      let tail = 0;
      queueX[tail] = x;
      queueY[tail] = y;
      tail++;

      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let area = 0;

      while (head < tail) {
        const cx = queueX[head];
        const cy = queueY[head];
        head++;
        area++;

        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        for (let dy = -1; dy <= 1; dy++) {
          const ny = cy + dy;
          if (ny < 0 || ny >= h) continue;
          const rowOff = ny * w;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            if (nx < 0 || nx >= w) continue;
            const nIdx = rowOff + nx;
            if (mask[nIdx] !== 0 && labels[nIdx] === 0) {
              labels[nIdx] = currentLabel;
              queueX[tail] = nx;
              queueY[tail] = ny;
              tail++;
            }
          }
        }
      }

      stats.push({
        label: currentLabel,
        left: minX,
        top: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        area,
      });
    }
  }

  return { labels, stats };
}

// ============================================================================
// EXACT PORT OF anh_the.py: _khop_duong, _dung_khung, _goc_tu_phong, tim_khung_theo_phong
// ============================================================================

/**
 * Port of `_khop_duong(t, v, dung_sai = 1.5)` from `anh_the.py`:
 * Fits line `v = a * t + b` using deterministic RANSAC (400 pairs) + least-squares polyfit refinement.
 */
function khopDuongRansac(
  t: Float64Array,
  v: Float64Array,
  dungSai = 1.5
): [number, number, number] | null {
  const n = t.length;
  if (n < 15) return null;

  let tMin = Infinity;
  let tMax = -Infinity;
  for (let k = 0; k < n; k++) {
    if (t[k] < tMin) tMin = t[k];
    if (t[k] > tMax) tMax = t[k];
  }
  const minSpan = Math.max(8.0, 0.15 * (tMax - tMin));

  // Deterministic PRNG (seeded LCG)
  let seed = 1337;
  const nextRandInt = (maxExclusive: number) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % maxExclusive;
  };

  const candA: number[] = [];
  const candB: number[] = [];

  for (let iter = 0; iter < 400; iter++) {
    const i = nextRandInt(n);
    const j = nextRandInt(n);
    const dt = t[j] - t[i];
    if (Math.abs(dt) <= minSpan) continue;
    const a = (v[j] - v[i]) / dt;
    if (Math.abs(a) >= 0.47) continue; // ảnh thẻ không nghiêng quá ~25 độ so với khuôn mặt
    const b = v[i] - a * t[i];
    candA.push(a);
    candB.push(b);
  }

  if (candA.length === 0) return null;

  let bestIdx = 0;
  let bestCount = -1;
  for (let m = 0; m < candA.length; m++) {
    const a = candA[m];
    const b = candB[m];
    let count = 0;
    for (let k = 0; k < n; k++) {
      if (Math.abs(v[k] - (a * t[k] + b)) < dungSai) {
        count++;
      }
    }
    if (count > bestCount) {
      bestCount = count;
      bestIdx = m;
    }
  }

  if (bestCount < 2) return null;

  // Least-squares polyfit(t[inliers], v[inliers], 1)
  const bestA = candA[bestIdx];
  const bestB = candB[bestIdx];
  let sumT = 0;
  let sumV = 0;
  let sumTT = 0;
  let sumTV = 0;
  let cnt = 0;
  for (let k = 0; k < n; k++) {
    if (Math.abs(v[k] - (bestA * t[k] + bestB)) < dungSai) {
      sumT += t[k];
      sumV += v[k];
      sumTT += t[k] * t[k];
      sumTV += t[k] * v[k];
      cnt++;
    }
  }

  const denom = cnt * sumTT - sumT * sumT;
  if (Math.abs(denom) < 1e-9) {
    return [bestA, bestB, bestCount];
  }
  const a2 = (cnt * sumTV - sumT * sumV) / denom;
  const b2 = (sumV - a2 * sumT) / cnt;
  return [a2, b2, bestCount];
}

/**
 * Port of `_dung_khung(aL, bL, aR, bR, aT, bT, mx, my, F)` from `anh_the.py`:
 * Constructs the 4 corners [tl, tr, br, bl] of the 3:4 ID photo from:
 * - left edge: x = aL * y + bL
 * - right edge: x = aR * y + bR
 * - top edge: y = aT * x + bT
 */
function dungKhung3x4(
  aL: number,
  bL: number,
  aR: number,
  bR: number,
  aT: number,
  bT: number,
  mx: number,
  my: number,
  F: number
): QuadCorners | null {
  const giao = (aDoc: number, bDoc: number): Point2D => {
    const denom = 1 - aT * aDoc;
    const yy = (aT * bDoc + bT) / (Math.abs(denom) < 1e-9 ? 1e-9 : denom);
    return [aDoc * yy + bDoc, yy];
  };

  const tl = giao(aL, bL);
  const tr = giao(aR, bR);
  const rong = Math.hypot(tr[0] - tl[0], tr[1] - tl[1]);

  // Khuôn mặt phải có cỡ và vị trí hợp lý trong khung
  if (!(MAT_RONG_MIN <= F / rong && F / rong <= MAT_RONG_MAX)) {
    return null;
  }
  const giua = (mx + F / 2 - tl[0]) / Math.max(tr[0] - tl[0], 1e-6);
  if (!(0.3 <= giua && giua <= 0.7) || my - (tl[1] + tr[1]) / 2 < 0.05 * F) {
    return null;
  }

  const cao = rong / TI_LE;
  const normL = Math.hypot(aL, 1.0);
  const normR = Math.hypot(aR, 1.0);
  const xuongTrai: Point2D = [aL / normL, 1.0 / normL];
  const xuongPhai: Point2D = [aR / normR, 1.0 / normR];

  const br: Point2D = [tr[0] + xuongPhai[0] * cao, tr[1] + xuongPhai[1] * cao];
  const bl: Point2D = [tl[0] + xuongTrai[0] * cao, tl[1] + xuongTrai[1] * cao];
  return [tl, tr, br, bl];
}

/**
 * Port of `_goc_tu_phong(phong, mx, my, F)` from `anh_the.py`.
 */
function gocTuPhong(
  phong: Uint8Array,
  vw: number,
  vh: number,
  mx: number,
  my: number,
  F: number
): QuadCorners | null {
  const hangList: number[] = [];
  const traiList: number[] = [];
  const phaiList: number[] = [];

  for (let y = 0; y < vh; y++) {
    const rowOff = y * vw;
    let firstX = -1;
    let lastX = -1;
    for (let x = 0; x < vw; x++) {
      if (phong[rowOff + x]) {
        if (firstX === -1) firstX = x;
        lastX = x;
      }
    }
    if (firstX !== -1) {
      hangList.push(y);
      traiList.push(firstX);
      phaiList.push(lastX);
    }
  }

  const cotList: number[] = [];
  const trenList: number[] = [];
  for (let x = 0; x < vw; x++) {
    let firstY = -1;
    for (let y = 0; y < vh; y++) {
      if (phong[y * vw + x]) {
        firstY = y;
        break;
      }
    }
    if (firstY !== -1) {
      cotList.push(x);
      trenList.push(firstY);
    }
  }

  const hang = new Float64Array(hangList);
  const trai = new Float64Array(traiList);
  const phai = new Float64Array(phaiList);
  const cot = new Float64Array(cotList);
  const tren = new Float64Array(trenList);

  const dl = khopDuongRansac(hang, trai); // x = aL * y + bL
  const dr = khopDuongRansac(hang, phai); // x = aR * y + bR
  const dt = khopDuongRansac(cot, tren); // y = aT * x + bT
  if (!dl || !dr || !dt) return null;

  const [aL, bL, nL] = dl;
  const [aR, bR, nR] = dr;
  const [aT, bT, nT] = dt;

  // Mép phải đủ dài và thẳng thì mới tin
  if (nL < 0.3 * F || nR < 0.3 * F || nT < 0.6 * F) {
    return null;
  }
  // Hai mép bên gần song song, mép trên gần vuông góc với chúng
  if (Math.abs(aL - aR) > 0.2 || Math.abs(aT + (aL + aR) / 2) > 0.15) {
    return null;
  }

  return dungKhung3x4(aL, bL, aR, bR, aT, bT, mx, my, F);
}

/**
 * Port of `tim_khung_theo_phong(anh, mat)` from `anh_the.py` (Method A).
 * Returns `{ corners, doMau }` or `null`.
 */
export function timKhungTheoPhong(
  img: HTMLImageElement | HTMLCanvasElement,
  face: { x: number; y: number; width: number; height: number }
): { corners: QuadCorners; doMau: number } | null {
  const W = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const H = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  const { x, y, width: fw, height: fh } = face;
  if (fw < 12 || fh < 12) return null;

  const x0 = Math.max(0, Math.floor(x - 1.3 * fw));
  const x1 = Math.min(W, Math.floor(x + 2.3 * fw));
  const y0 = Math.max(0, Math.floor(y - 1.3 * fh));
  const y1 = Math.min(H, Math.floor(y + 3.2 * fh));

  const F = 150.0;
  const k = F / fw;
  const vw = Math.max(24, Math.round((x1 - x0) * k));
  const vh = Math.max(24, Math.round((y1 - y0) * k));

  const canvas = document.createElement('canvas');
  canvas.width = vw;
  canvas.height = vh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, vw, vh);
  const { data: rgba } = ctx.getImageData(0, 0, vw, vh);

  // GaussianBlur 5x5 + LAB with L *= 0.35 (exact anh_the.py formula)
  const lab = computeBlurredLabBuffer(rgba, vw, vh, 0.35);

  const mx = (x - x0) * k;
  const my = (y - y0) * k;
  const cx = mx + F / 2;

  const sampleOffsets: Array<[number, number]> = [
    [0.8, 0.0],
    [0.8, -0.25],
    [0.65, -0.35],
    [0.95, 0.2],
    [0.5, -0.42],
    [0.7, 0.4],
  ];

  const mauDaThu: Array<[number, number, number]> = [];
  const ungVien: Array<{
    score: number;
    phong: Uint8Array;
    doMau: number;
  }> = [];

  // Allow full-bleed 3x4 portrait images where the ROI touches the image border
  const touchesLeftImg = x0 === 0;
  const touchesTopImg = y0 === 0;
  const touchesRightImg = x1 === W;

  for (const [dx, dy] of sampleOffsets) {
    for (const dau of [-1, 1]) {
      const px = Math.floor(cx + dau * dx * F);
      const py = Math.floor(my + dy * F);
      if (!(8 <= px && px < vw - 8 && 8 <= py && py < vh - 8)) continue;

      const patchL: number[] = [];
      const patchA: number[] = [];
      const patchB: number[] = [];

      for (let yy = py - 6; yy <= py + 6; yy++) {
        for (let xx = px - 6; xx <= px + 6; xx++) {
          const idx = (yy * vw + xx) * 3;
          patchL.push(lab[idx]);
          patchA.push(lab[idx + 1]);
          patchB.push(lab[idx + 2]);
        }
      }

      const stdOf = (arr: number[]) => {
        const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
        const variance =
          arr.reduce((s, v) => s + (v - mean) * (v - mean), 0) / arr.length;
        return Math.sqrt(variance);
      };

      if (Math.max(stdOf(patchL), stdOf(patchA), stdOf(patchB)) > 5.0) {
        continue; // ô mẫu không đều màu (tóc, mép ảnh...) -> bỏ
      }

      const mau: [number, number, number] = [
        medianOfArray(patchL),
        medianOfArray(patchA),
        medianOfArray(patchB),
      ];

      if (
        mauDaThu.some(
          (m) =>
            Math.hypot(mau[0] - m[0], mau[1] - m[1], mau[2] - m[2]) < 4.0
        )
      ) {
        continue;
      }
      mauDaThu.push(mau);

      // giong = (norm(lab - mau) < 12)
      const giongRaw = new Uint8Array(vw * vh);
      for (let i = 0; i < vw * vh; i++) {
        const dL = lab[i * 3] - mau[0];
        const da = lab[i * 3 + 1] - mau[1];
        const db = lab[i * 3 + 2] - mau[2];
        if (dL * dL + da * da + db * db < 144) {
          giongRaw[i] = 1;
        }
      }

      const giong = morphOpen(giongRaw, vw, vh, 3, 3);
      const { labels, stats } = connectedComponentsWithStats8(giong, vw, vh);

      // Giữ các mảng nằm gọn trong vùng xét. Mảng chạm mép vùng xét là giấy / mặt bàn.
      let giu = stats
        .slice(1)
        .filter(
          (st) =>
            st.area >= 0.01 * F * F &&
            st.left > 0 &&
            st.top > 0 &&
            st.left + st.width < vw &&
            st.top + st.height < vh
        )
        .map((st) => st.label);

      // Fallback only if the source image itself is already a tight cropped 3x4 portrait
      if (
        giu.length === 0 &&
        touchesLeftImg &&
        touchesRightImg &&
        touchesTopImg &&
        Math.abs(W / H - TI_LE) < 0.12
      ) {
        giu = stats
          .slice(1)
          .filter((st) => st.area >= 0.05 * F * F)
          .map((st) => st.label);
      }

      if (giu.length === 0) continue;

      const lonNhat = Math.max(...giu.map((lbl) => stats[lbl].area));
      const giuSet = new Set(
        giu.filter((lbl) => stats[lbl].area >= 0.05 * lonNhat)
      );

      const phong = new Uint8Array(vw * vh);
      let totalPhong = 0;
      let leftPhong = 0;
      let rightPhong = 0;
      const mxInt = Math.floor(mx);
      const mxRightInt = Math.floor(mx + F);
      const chinY = Math.min(vh, Math.floor(my + F));

      let minXAboveChin = vw;
      let maxXAboveChin = -1;
      let minYAboveChin = vh;
      let maxYAboveChin = -1;

      for (let yy = 0; yy < vh; yy++) {
        const rowOff = yy * vw;
        for (let xx = 0; xx < vw; xx++) {
          const idx = rowOff + xx;
          if (giuSet.has(labels[idx])) {
            phong[idx] = 1;
            totalPhong++;
            if (xx < mxInt) leftPhong++;
            if (xx >= mxRightInt) rightPhong++;
            if (yy < chinY) {
              if (xx < minXAboveChin) minXAboveChin = xx;
              if (xx > maxXAboveChin) maxXAboveChin = xx;
              if (yy < minYAboveChin) minYAboveChin = yy;
              if (yy > maxYAboveChin) maxYAboveChin = yy;
            }
          }
        }
      }

      if (totalPhong < 0.35 * F * F) continue;
      if (leftPhong < 0.04 * F * F || rightPhong < 0.04 * F * F) continue;
      if (maxXAboveChin < minXAboveChin) continue;

      const doMau = Math.hypot(mau[1] - 128, mau[2] - 128);
      const bboxArea =
        (maxXAboveChin - minXAboveChin) * (maxYAboveChin - minYAboveChin);
      ungVien.push({ score: bboxArea, phong, doMau });
    }
  }

  ungVien.sort((a, b) => b.score - a.score);

  const le = 0.02 * Math.max(H, W);
  for (const cand of ungVien) {
    const gocLocal = gocTuPhong(cand.phong, vw, vh, mx, my, F);
    if (!gocLocal) continue;

    const gocGlobal: QuadCorners = [
      [gocLocal[0][0] / k + x0, gocLocal[0][1] / k + y0],
      [gocLocal[1][0] / k + x0, gocLocal[1][1] / k + y0],
      [gocLocal[2][0] / k + x0, gocLocal[2][1] / k + y0],
      [gocLocal[3][0] / k + x0, gocLocal[3][1] / k + y0],
    ];

    const outOfBounds = gocGlobal.some(
      (pt) =>
        pt[0] < -le || pt[0] > W + le || pt[1] < -le || pt[1] > H + le
    );
    if (outOfBounds) continue;

    return { corners: gocGlobal, doMau: cand.doMau };
  }

  return null;
}

// ============================================================================
// EXACT PORT OF anh_the.py: tim_khung_theo_mep (Method A2: 3 Long Straight Lines)
// ============================================================================

/**
 * Port of `tim_khung_theo_mep(anh, mat)` from `anh_the.py` (Method A2).
 * Finds 3 long straight edges (left, right, top) around a candidate face.
 * Works on white-backdrop photos glued onto documents surrounded by text & red stamps.
 */
export function timKhungTheoMep(
  img: HTMLImageElement | HTMLCanvasElement,
  face: { x: number; y: number; width: number; height: number }
): { corners: QuadCorners; score: number } | null {
  const W = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const H = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  const { x, y, width: fw, height: fh } = face;
  if (fw < 12 || fh < 12) return null;

  const x0 = Math.max(0, Math.floor(x - 1.3 * fw));
  const x1 = Math.min(W, Math.floor(x + 2.3 * fw));
  const y0 = Math.max(0, Math.floor(y - 1.3 * fh));
  const y1 = Math.min(H, Math.floor(y + 3.2 * fh));

  const F = 150.0;
  const k = F / fw;
  const vw = Math.max(24, Math.round((x1 - x0) * k));
  const vh = Math.max(24, Math.round((y1 - y0) * k));

  const canvas = document.createElement('canvas');
  canvas.width = vw;
  canvas.height = vh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, vw, vh);
  const { data: rgba } = ctx.getImageData(0, 0, vw, vh);

  const mx = (x - x0) * k;
  const my = (y - y0) * k;
  const cx = mx + F / 2;
  const cy = my + F / 2;

  // Grayscale + 3x3 Gaussian blur
  const grayRaw = new Float32Array(vw * vh);
  for (let i = 0; i < vw * vh; i++) {
    const idx = i * 4;
    grayRaw[i] =
      0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
  }
  const xam = new Float32Array(vw * vh);
  for (let yy = 0; yy < vh; yy++) {
    for (let xx = 0; xx < vw; xx++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const y2 = Math.max(0, Math.min(vh - 1, yy + dy));
        const wy = dy === 0 ? 2 : 1;
        for (let dx = -1; dx <= 1; dx++) {
          const x2 = Math.max(0, Math.min(vw - 1, xx + dx));
          const wx = dx === 0 ? 2 : 1;
          sum += grayRaw[y2 * vw + x2] * wx * wy;
        }
      }
      xam[yy * vw + xx] = sum / 16;
    }
  }

  // Sobel |Gx| and |Gy|
  const docRaw = new Uint8Array(vw * vh);
  const ngangRaw = new Uint8Array(vw * vh);
  for (let yy = 1; yy < vh - 1; yy++) {
    for (let xx = 1; xx < vw - 1; xx++) {
      const tl = xam[(yy - 1) * vw + (xx - 1)];
      const tc = xam[(yy - 1) * vw + xx];
      const tr = xam[(yy - 1) * vw + (xx + 1)];
      const ml = xam[yy * vw + (xx - 1)];
      const mr = xam[yy * vw + (xx + 1)];
      const bl = xam[(yy + 1) * vw + (xx - 1)];
      const bc = xam[(yy + 1) * vw + xx];
      const br = xam[(yy + 1) * vw + (xx + 1)];

      const gx = Math.abs(-tl + tr - 2 * ml + 2 * mr - bl + br);
      const gy = Math.abs(-tl - 2 * tc - tr + bl + 2 * bc + br);

      const idx = yy * vw + xx;
      if (gx > MEP_NGUONG && gx > 1.5 * gy) docRaw[idx] = 1;
      if (gy > MEP_NGUONG && gy > 1.5 * gx) ngangRaw[idx] = 1;
    }
  }

  // Dilate doc with (width=3, height=1) and ngang with (width=1, height=3)
  const doc = dilateMask(docRaw, vw, vh, 3, 1);
  const ngang = dilateMask(ngangRaw, vw, vh, 1, 3);

  const ya = Math.max(0, Math.floor(my - 0.3 * F));
  const yb = Math.min(vh, Math.floor(my + 1.4 * F));
  if (yb - ya < 1.2 * F) return null;

  const chon = (
    doPhu: Float32Array,
    aIn: number,
    bIn: number,
    trongLaCuoi: boolean
  ): [number, number] | null => {
    const a = Math.max(0, aIn);
    const b = Math.min(doPhu.length, bIn);
    if (b - a < 3) return null;
    let cMax = -Infinity;
    for (let i = a; i < b; i++) {
      if (doPhu[i] > cMax) cMax = doPhu[i];
    }
    if (cMax < 0.5) return null;
    const thresh = Math.max(0.5, 0.88 * cMax);
    const ro: number[] = [];
    for (let i = a; i < b; i++) {
      if (doPhu[i] >= thresh) ro.push(i);
    }
    if (ro.length === 0) return null;
    const picked = trongLaCuoi ? ro[ro.length - 1] : ro[0];
    return [picked, doPhu[picked]];
  };

  let tot: {
    diem: number;
    s: number;
    xl: number;
    xr: number;
    yt: number;
  } | null = null;

  for (let doDeg = -8; doDeg <= 8; doDeg++) {
    const s = Math.tan((doDeg * Math.PI) / 180);

    // Column coverage of sheared vertical edge map in [ya, yb)
    const phuDoc = new Float32Array(vw);
    const spanY = yb - ya;
    for (let xx = 0; xx < vw; xx++) {
      let sum = 0;
      for (let yy = ya; yy < yb; yy++) {
        const srcX = Math.round(xx + s * (yy - cy));
        if (srcX >= 0 && srcX < vw && doc[yy * vw + srcX]) {
          sum++;
        }
      }
      phuDoc[xx] = sum / spanY;
    }

    const trai = chon(
      phuDoc,
      Math.floor(cx - 1.5 * F),
      Math.floor(cx - 0.6 * F),
      true
    );
    const phai = chon(
      phuDoc,
      Math.floor(cx + 0.6 * F),
      Math.floor(cx + 1.5 * F),
      false
    );
    if (!trai || !phai) continue;

    const xStart = trai[0] + 4;
    const xEnd = phai[0] - 4;
    if (xEnd - xStart < 8) continue;

    // Row coverage of sheared horizontal edge map between [trai[0]+4, phai[0]-4)
    const phuNgang = new Float32Array(vh);
    const spanX = xEnd - xStart;
    for (let yy = 0; yy < vh; yy++) {
      let sum = 0;
      for (let xx = xStart; xx < xEnd; xx++) {
        const srcY = Math.round(yy - s * (xx - cx));
        if (srcY >= 0 && srcY < vh && ngang[srcY * vw + xx]) {
          sum++;
        }
      }
      phuNgang[yy] = sum / spanX;
    }

    const tren = chon(
      phuNgang,
      Math.floor(my - 1.05 * F),
      Math.floor(my - 0.1 * F),
      true
    );
    if (!tren) continue;

    const diem = trai[1] + phai[1] + tren[1];
    if (!tot || diem > tot.diem) {
      tot = { diem, s, xl: trai[0], xr: phai[0], yt: tren[0] };
    }
  }

  if (!tot) return null;
  const { diem, s, xl, xr, yt } = tot;
  const gocLocal = dungKhung3x4(
    s,
    xl - s * cy,
    s,
    xr - s * cy,
    -s,
    yt + s * cx,
    mx,
    my,
    F
  );
  if (!gocLocal) return null;

  const gocGlobal: QuadCorners = [
    [gocLocal[0][0] / k + x0, gocLocal[0][1] / k + y0],
    [gocLocal[1][0] / k + x0, gocLocal[1][1] / k + y0],
    [gocLocal[2][0] / k + x0, gocLocal[2][1] / k + y0],
    [gocLocal[3][0] / k + x0, gocLocal[3][1] / k + y0],
  ];

  const le = 0.02 * Math.max(H, W);
  if (
    gocGlobal.some(
      (pt) => pt[0] < -le || pt[0] > W + le || pt[1] < -le || pt[1] > H + le
    )
  ) {
    return null;
  }

  return { corners: gocGlobal, score: diem };
}

// ============================================================================
// EXACT PORT OF anh_the.py: Method B (tim_to_anh + khung_trong_to)
// ============================================================================

function sapXepGoc(pts: Point2D[]): QuadCorners {
  let minSumIdx = 0;
  let maxSumIdx = 0;
  let maxDiffIdx = 0;
  let minDiffIdx = 0;

  for (let i = 1; i < 4; i++) {
    const sumI = pts[i][0] + pts[i][1];
    const diffI = pts[i][0] - pts[i][1];
    if (sumI < pts[minSumIdx][0] + pts[minSumIdx][1]) minSumIdx = i;
    if (sumI > pts[maxSumIdx][0] + pts[maxSumIdx][1]) maxSumIdx = i;
    if (diffI > pts[maxDiffIdx][0] - pts[maxDiffIdx][1]) maxDiffIdx = i;
    if (diffI < pts[minDiffIdx][0] - pts[minDiffIdx][1]) minDiffIdx = i;
  }

  return [
    [pts[minSumIdx][0], pts[minSumIdx][1]], // top-left
    [pts[maxDiffIdx][0], pts[maxDiffIdx][1]], // top-right
    [pts[maxSumIdx][0], pts[maxSumIdx][1]], // bottom-right
    [pts[minDiffIdx][0], pts[minDiffIdx][1]], // bottom-left
  ];
}

/**
 * Monotone chain 2D convex hull + polygon area.
 */
function convexHullAndArea(points: Point2D[]): {
  hull: Point2D[];
  area: number;
} {
  if (points.length < 3) return { hull: points, area: 0 };
  const pts = [...points].sort((a, b) =>
    a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]
  );

  const cross = (o: Point2D, a: Point2D, b: Point2D) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: Point2D[] = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point2D[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  const hull = lower.concat(upper);

  let area2 = 0;
  for (let i = 0; i < hull.length; i++) {
    const j = (i + 1) % hull.length;
    area2 += hull[i][0] * hull[j][1] - hull[j][0] * hull[i][1];
  }
  return { hull, area: Math.abs(area2) * 0.5 };
}

/**
 * Finds minimum-area oriented bounding rectangle (`minAreaRect`) of a convex hull.
 */
function minAreaRectOfHull(hull: Point2D[]): {
  rw: number;
  rh: number;
  corners: QuadCorners;
  angleDeg: number;
} {
  let bestArea = Infinity;
  let bestRw = 0;
  let bestRh = 0;
  let bestAngleRad = 0;
  let bestMinU = 0;
  let bestMaxU = 0;
  let bestMinV = 0;
  let bestMaxV = 0;

  for (let i = 0; i < hull.length; i++) {
    const p1 = hull[i];
    const p2 = hull[(i + 1) % hull.length];
    const ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;

    for (const p of hull) {
      const u = p[0] * cosA + p[1] * sinA;
      const v = -p[0] * sinA + p[1] * cosA;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    const rw = maxU - minU;
    const rh = maxV - minV;
    const area = rw * rh;
    if (area < bestArea) {
      bestArea = area;
      bestRw = rw;
      bestRh = rh;
      bestAngleRad = ang;
      bestMinU = minU;
      bestMaxU = maxU;
      bestMinV = minV;
      bestMaxV = maxV;
    }
  }

  const cosA = Math.cos(bestAngleRad);
  const sinA = Math.sin(bestAngleRad);
  const toXY = (u: number, v: number): Point2D => [
    u * cosA - v * sinA,
    u * sinA + v * cosA,
  ];

  const rawPts: Point2D[] = [
    toXY(bestMinU, bestMinV),
    toXY(bestMaxU, bestMinV),
    toXY(bestMaxU, bestMaxV),
    toXY(bestMinU, bestMaxV),
  ];
  const corners = sapXepGoc(rawPts);
  const topDx = corners[1][0] - corners[0][0];
  const topDy = corners[1][1] - corners[0][1];
  const angleDeg = (Math.atan2(topDy, topDx) * 180) / Math.PI;

  return { rw: bestRw, rh: bestRh, corners, angleDeg };
}

/**
 * Port of `tim_to_anh(anh)` from `anh_the.py` (Method B).
 * Detects rectangular photo paper sheets lying on a desk/background using multi-channel LAB edges + morphology.
 */
export function timToAnh(
  img: HTMLImageElement | HTMLCanvasElement
): QuadCorners[] {
  const W = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const H = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  const k = Math.min(1.0, 600 / Math.max(H, W));
  const nw = Math.max(40, Math.round(W * k));
  const nh = Math.max(40, Math.round(H * k));

  const canvas = document.createElement('canvas');
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, nw, nh);
  const { data: rgba } = ctx.getImageData(0, 0, nw, nh);

  const lab = computeBlurredLabBuffer(rgba, nw, nh, 1.0);
  const canhRaw = new Uint8Array(nw * nh);

  // Multi-channel LAB gradient edge detector (matches Canny(lab[..., i], 12, 36) across L, a, b)
  for (let y = 1; y < nh - 1; y++) {
    for (let x = 1; x < nw - 1; x++) {
      let isEdge = 0;
      for (let c = 0; c < 3; c++) {
        const tl = lab[((y - 1) * nw + (x - 1)) * 3 + c];
        const tc = lab[((y - 1) * nw + x) * 3 + c];
        const tr = lab[((y - 1) * nw + (x + 1)) * 3 + c];
        const ml = lab[(y * nw + (x - 1)) * 3 + c];
        const mr = lab[(y * nw + (x + 1)) * 3 + c];
        const bl = lab[((y + 1) * nw + (x - 1)) * 3 + c];
        const bc = lab[((y + 1) * nw + x) * 3 + c];
        const br = lab[((y + 1) * nw + (x + 1)) * 3 + c];

        const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
        const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
        const mag = Math.hypot(gx, gy) / 4.0;
        if (mag >= 11.0) {
          isEdge = 1;
          break;
        }
      }
      if (isEdge) canhRaw[y * nw + x] = 1;
    }
  }

  // Dilate 3x3 then Morph Close 7x7
  const dilated = dilateMask(canhRaw, nw, nh, 3, 3);
  const closed = morphClose(dilated, nw, nh, 7, 7);

  // Flood-fill exterior background from image borders so interior enclosed photo sheets become solid components
  const visitedBg = new Uint8Array(nw * nh);
  const qx = new Int32Array(nw * nh);
  const qy = new Int32Array(nw * nh);
  let head = 0;
  let tail = 0;

  const pushBg = (x: number, y: number) => {
    const idx = y * nw + x;
    if (!visitedBg[idx] && closed[idx] === 0) {
      visitedBg[idx] = 1;
      qx[tail] = x;
      qy[tail] = y;
      tail++;
    }
  };

  for (let x = 0; x < nw; x++) {
    pushBg(x, 0);
    pushBg(x, nh - 1);
  }
  for (let y = 0; y < nh; y++) {
    pushBg(0, y);
    pushBg(nw - 1, y);
  }

  while (head < tail) {
    const cx = qx[head];
    const cy = qy[head];
    head++;
    if (cx > 0) pushBg(cx - 1, cy);
    if (cx < nw - 1) pushBg(cx + 1, cy);
    if (cy > 0) pushBg(cx, cy - 1);
    if (cy < nh - 1) pushBg(cx, cy + 1);
  }

  const fgMask = new Uint8Array(nw * nh);
  for (let i = 0; i < nw * nh; i++) {
    if (!visitedBg[i]) fgMask[i] = 1;
  }

  const { labels, stats } = connectedComponentsWithStats8(fgMask, nw, nh);
  const ungVien: Array<{ dt: number; corners: QuadCorners }> = [];

  for (let i = 1; i < stats.length; i++) {
    const st = stats[i];
    if (st.area < 0.003 * nh * nw || st.area > 0.65 * nh * nw) continue;
    if (
      st.left < 1 ||
      st.top < 1 ||
      st.left + st.width > nw - 1 ||
      st.top + st.height > nh - 1
    ) {
      continue;
    }

    // Collect boundary points of this component for convex hull
    const boundaryPts: Point2D[] = [];
    for (let y = st.top; y < st.top + st.height; y++) {
      const rowOff = y * nw;
      let firstX = -1;
      let lastX = -1;
      for (let x = st.left; x < st.left + st.width; x++) {
        if (labels[rowOff + x] === st.label) {
          if (firstX === -1) firstX = x;
          lastX = x;
        }
      }
      if (firstX !== -1) {
        boundaryPts.push([firstX, y]);
        if (lastX !== firstX) boundaryPts.push([lastX, y]);
      }
    }

    const { hull, area: dt } = convexHullAndArea(boundaryPts);
    if (!(0.003 * nh * nw <= dt && dt <= 0.6 * nh * nw)) continue;

    const { rw, rh, corners } = minAreaRectOfHull(hull);
    const minSide = Math.min(rw, rh);
    const maxSide = Math.max(rw, rh);
    if (minSide < 20 || dt / Math.max(1, rw * rh) < 0.80) continue;
    if (!(0.55 <= minSide / maxSide && minSide / maxSide <= 0.92)) continue;

    const scaledCorners: QuadCorners = [
      [corners[0][0] / k, corners[0][1] / k],
      [corners[1][0] / k, corners[1][1] / k],
      [corners[2][0] / k, corners[2][1] / k],
      [corners[3][0] / k, corners[3][1] / k],
    ];
    ungVien.push({ dt, corners: scaledCorners });
  }

  ungVien.sort((a, b) => b.dt - a.dt);
  return ungVien.map((u) => u.corners);
}

/**
 * Port of `khung_trong_to(to, mat)` from `anh_the.py`:
 * Trims the white paper rim (up to 9% on each side) inside a deskewed photo card and enforces 3:4 aspect ratio.
 */
function khungTrongTo(
  toCanvas: HTMLCanvasElement,
  mat: { x: number; y: number; width: number; height: number }
): QuadCorners {
  const w = toCanvas.width;
  const h = toCanvas.height;
  const ctx = toCanvas.getContext('2d');
  if (!ctx) {
    return [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ];
  }

  const { data: rgba } = ctx.getImageData(0, 0, w, h);
  const lab = computeBlurredLabBuffer(rgba, w, h, 1.0);

  const i0 = Math.max(2, Math.round(0.02 * w));
  const d = Math.max(2, Math.round(0.015 * w));

  const vanhL: number[] = [];
  const vanhA: number[] = [];
  const vanhB: number[] = [];

  const pushSample = (xx: number, yy: number) => {
    const idx = (yy * w + xx) * 3;
    vanhL.push(lab[idx]);
    vanhA.push(lab[idx + 1]);
    vanhB.push(lab[idx + 2]);
  };

  for (let yy = i0; yy < i0 + d && yy < h - i0; yy++) {
    for (let xx = i0; xx < w - i0; xx++) pushSample(xx, yy);
  }
  for (let yy = Math.max(i0, h - i0 - d); yy < h - i0; yy++) {
    for (let xx = i0; xx < w - i0; xx++) pushSample(xx, yy);
  }
  for (let yy = i0; yy < h - i0; yy++) {
    for (let xx = i0; xx < i0 + d && xx < w - i0; xx++) pushSample(xx, yy);
    for (let xx = Math.max(i0, w - i0 - d); xx < w - i0; xx++) pushSample(xx, yy);
  }

  const medVanh: [number, number, number] = [
    medianOfArray(vanhL),
    medianOfArray(vanhA),
    medianOfArray(vanhB),
  ];

  const khac = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const dL = lab[i * 3] - medVanh[0];
    const da = lab[i * 3 + 1] - medVanh[1];
    const db = lab[i * 3 + 2] - medVanh[2];
    if (Math.hypot(dL, da, db) > 7.0) {
      khac[i] = 1;
    }
  }

  const ghX = Math.floor(0.09 * w);
  const ghY = Math.floor(0.09 * h);

  // Top border
  let y0 = i0;
  for (let yy = i0; yy < ghY; yy++) {
    let ok = true;
    for (let k = 0; k < 3; k++) {
      let sum = 0;
      for (let xx = i0; xx < w - i0; xx++) sum += khac[(yy + k) * w + xx];
      if (sum / Math.max(1, w - 2 * i0) <= 0.5) {
        ok = false;
        break;
      }
    }
    if (ok) {
      y0 = yy + 1;
      break;
    }
  }

  // Bottom border
  let y1 = h - i0;
  for (let i = i0; i < ghY; i++) {
    let ok = true;
    for (let k = 0; k < 3; k++) {
      const yy = h - 1 - (i + k);
      let sum = 0;
      for (let xx = i0; xx < w - i0; xx++) sum += khac[yy * w + xx];
      if (sum / Math.max(1, w - 2 * i0) <= 0.5) {
        ok = false;
        break;
      }
    }
    if (ok) {
      y1 = h - (i + 1);
      break;
    }
  }

  // Left border
  let x0 = i0;
  for (let xx = i0; xx < ghX; xx++) {
    let ok = true;
    for (let k = 0; k < 3; k++) {
      let sum = 0;
      for (let yy = i0; yy < h - i0; yy++) sum += khac[yy * w + (xx + k)];
      if (sum / Math.max(1, h - 2 * i0) <= 0.5) {
        ok = false;
        break;
      }
    }
    if (ok) {
      x0 = xx + 1;
      break;
    }
  }

  // Right border
  let x1 = w - i0;
  for (let i = i0; i < ghX; i++) {
    let ok = true;
    for (let k = 0; k < 3; k++) {
      const xx = w - 1 - (i + k);
      let sum = 0;
      for (let yy = i0; yy < h - i0; yy++) sum += khac[yy * w + xx];
      if (sum / Math.max(1, h - 2 * i0) <= 0.5) {
        ok = false;
        break;
      }
    }
    if (ok) {
      x1 = w - (i + 1);
      break;
    }
  }

  const rong = x1 - x0;
  const cao = y1 - y0;
  if (rong / cao > TI_LE) {
    const moi = cao * TI_LE;
    const xa = Math.min(Math.max(mat.x + mat.width / 2 - moi / 2, x0), x1 - moi);
    x0 = xa;
    x1 = xa + moi;
  } else {
    y1 = y0 + rong / TI_LE;
  }

  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

// ============================================================================
// EXACT PORT OF anh_the.py: Method C (cat_theo_mat)
// ============================================================================

/**
 * Port of `cat_theo_mat(anh, mat)` from `anh_the.py` (Method C: 3:4 crop around face, no rotation).
 */
export function catTheoMat(
  W: number,
  H: number,
  mat: { x: number; y: number; width: number; height: number }
): QuadCorners {
  const { x, y, width: fw } = mat;
  let rong = fw / MAT_RONG;
  let cao = rong / TI_LE;
  const ti = Math.min(1.0, W / rong, H / cao);
  rong *= ti;
  cao *= ti;
  const x0 = Math.round(Math.min(Math.max(x + fw / 2 - rong / 2, 0), W - rong));
  const y0 = Math.round(Math.min(Math.max(y - MAT_Y * cao, 0), H - cao));
  const rRound = Math.round(rong);
  const cRound = Math.round(cao);
  return [
    [x0, y0],
    [x0 + rRound, y0],
    [x0 + rRound, y0 + cRound],
    [x0, y0 + cRound],
  ];
}

// ============================================================================
// PERSPECTIVE WARP (nan_thang), RED STAMP REMOVAL (tim_vong_dau + xoa_dau_do),
// WHITE PAPER SAMPLING (mau_giay_quanh), AND BEAUTIFICATION (hoan_thien)
// ============================================================================

/**
 * Solves an 8x8 linear system for homography matrix H mapping `dst` (u, v) -> `src` (x, y)
 * so we can inverse-map pixels with bicubic/bilinear interpolation (`nan_thang` in `anh_the.py`).
 */
function computeHomographyMatrix(
  src: QuadCorners,
  dst: QuadCorners
): Float64Array {
  // We solve for H mapping dst (u,v) -> src (x,y) directly for inverse warping
  const A: number[][] = [];
  const B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const u = dst[i][0];
    const v = dst[i][1];
    const x = src[i][0];
    const y = src[i][1];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    B.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    B.push(y);
  }

  // Gaussian elimination with partial pivoting
  const n = 8;
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
    }
    [A[i], A[maxRow]] = [A[maxRow], A[i]];
    [B[i], B[maxRow]] = [B[maxRow], B[i]];

    const pivot = A[i][i];
    if (Math.abs(pivot) < 1e-12) continue;
    for (let k = i + 1; k < n; k++) {
      const factor = A[k][i] / pivot;
      B[k] -= factor * B[i];
      for (let j = i; j < n; j++) {
        A[k][j] -= factor * A[i][j];
      }
    }
  }

  const h = new Float64Array(9);
  for (let i = n - 1; i >= 0; i--) {
    let sum = B[i];
    for (let j = i + 1; j < n; j++) {
      sum -= A[i][j] * h[j];
    }
    h[i] = Math.abs(A[i][i]) < 1e-12 ? 0 : sum / A[i][i];
  }
  h[8] = 1;
  return h;
}

function applyHomographyPoint(H: Float64Array, u: number, v: number): Point2D {
  const w = H[6] * u + H[7] * v + H[8];
  const invW = Math.abs(w) < 1e-9 ? 1 : 1 / w;
  return [(H[0] * u + H[1] * v + H[2]) * invW, (H[3] * u + H[4] * v + H[5]) * invW];
}

/**
 * Port of `nan_thang(anh, goc, ti_le)` from `anh_the.py`.
 * Warps the 4-corner quadrilateral `goc` into a straight rectangular canvas.
 */
export function nanThangQuadToCanvas(
  img: HTMLImageElement | HTMLCanvasElement,
  goc: QuadCorners,
  tiLe: number | null = TI_LE
): {
  canvas: HTMLCanvasElement;
  invH: Float64Array; // maps warped (u, v) -> original (x, y)
  fwdH: Float64Array; // maps original (x, y) -> warped (u, v)
} {
  const [tl, tr, br, bl] = goc;
  const rong = Math.max(
    16,
    Math.round(
      Math.max(
        Math.hypot(tr[0] - tl[0], tr[1] - tl[1]),
        Math.hypot(br[0] - bl[0], br[1] - bl[1])
      )
    )
  );
  const cao = tiLe
    ? Math.max(16, Math.round(rong / tiLe))
    : Math.max(
        16,
        Math.round(
          Math.max(
            Math.hypot(bl[0] - tl[0], bl[1] - tl[1]),
            Math.hypot(br[0] - tr[0], br[1] - tr[1])
          )
        )
      );

  const dich: QuadCorners = [
    [0, 0],
    [rong - 1, 0],
    [rong - 1, cao - 1],
    [0, cao - 1],
  ];

  const invH = computeHomographyMatrix(goc, dich); // dst -> src
  const fwdH = computeHomographyMatrix(dich, goc); // src -> dst

  // Extract bounding ROI from source image for fast bilinear sampling
  const imgW = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const imgH = img instanceof HTMLImageElement ? img.naturalHeight : img.height;

  const minX = Math.max(
    0,
    Math.floor(Math.min(tl[0], tr[0], br[0], bl[0])) - 4
  );
  const minY = Math.max(
    0,
    Math.floor(Math.min(tl[1], tr[1], br[1], bl[1])) - 4
  );
  const maxX = Math.min(
    imgW,
    Math.ceil(Math.max(tl[0], tr[0], br[0], bl[0])) + 4
  );
  const maxY = Math.min(
    imgH,
    Math.ceil(Math.max(tl[1], tr[1], br[1], bl[1])) + 4
  );
  const srcW = Math.max(1, maxX - minX);
  const srcH = Math.max(1, maxY - minY);

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const srcCtx = srcCanvas.getContext('2d');
  const outCanvas = document.createElement('canvas');
  outCanvas.width = rong;
  outCanvas.height = cao;
  const outCtx = outCanvas.getContext('2d');

  if (!srcCtx || !outCtx) {
    return { canvas: outCanvas, invH, fwdH };
  }

  srcCtx.drawImage(img, minX, minY, srcW, srcH, 0, 0, srcW, srcH);
  const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;
  const outImg = outCtx.createImageData(rong, cao);
  const dstData = outImg.data;

  for (let v = 0; v < cao; v++) {
    for (let u = 0; u < rong; u++) {
      const [gx, gy] = applyHomographyPoint(invH, u, v);
      const sx = Math.max(0, Math.min(srcW - 1.001, gx - minX));
      const sy = Math.max(0, Math.min(srcH - 1.001, gy - minY));

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const dx = sx - x0;
      const dy = sy - y0;

      const i00 = (y0 * srcW + x0) * 4;
      const i10 = (y0 * srcW + (x0 + 1)) * 4;
      const i01 = ((y0 + 1) * srcW + x0) * 4;
      const i11 = ((y0 + 1) * srcW + (x0 + 1)) * 4;

      const w00 = (1 - dx) * (1 - dy);
      const w10 = dx * (1 - dy);
      const w01 = (1 - dx) * dy;
      const w11 = dx * dy;

      const outIdx = (v * rong + u) * 4;
      dstData[outIdx] =
        srcData[i00] * w00 +
        srcData[i10] * w10 +
        srcData[i01] * w01 +
        srcData[i11] * w11;
      dstData[outIdx + 1] =
        srcData[i00 + 1] * w00 +
        srcData[i10 + 1] * w10 +
        srcData[i01 + 1] * w01 +
        srcData[i11 + 1] * w11;
      dstData[outIdx + 2] =
        srcData[i00 + 2] * w00 +
        srcData[i10 + 2] * w10 +
        srcData[i01 + 2] * w01 +
        srcData[i11 + 2] * w11;
      dstData[outIdx + 3] = 255;
    }
  }

  outCtx.putImageData(outImg, 0, 0);
  return { canvas: outCanvas, invH, fwdH };
}

/**
 * Port of `tim_vong_dau(nen, goc)` from `anh_the.py`:
 * Finds red circular stamp arcs on the surrounding white document paper that overlap the ID photo.
 */
export function timVongDau(
  img: HTMLImageElement | HTMLCanvasElement,
  goc: QuadCorners
): Array<[number, number, number]> {
  const W = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const H = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  const rong = Math.hypot(goc[1][0] - goc[0][0], goc[1][1] - goc[0][1]);
  if (rong < 20) return [];

  const xs = goc.map((p) => p[0]);
  const ys = goc.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - 1.1 * rong));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - 1.1 * rong));
  const x1 = Math.min(W, Math.ceil(Math.max(...xs) + 1.1 * rong));
  const y1 = Math.min(H, Math.ceil(Math.max(...ys) + 1.1 * rong));

  const k = 300.0 / rong;
  const cw = Math.max(30, Math.round((x1 - x0) * k));
  const ch = Math.max(30, Math.round((y1 - y0) * k));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, cw, ch);
  const { data: rgba } = ctx.getImageData(0, 0, cw, ch);

  const tuGiac: QuadCorners = [
    [(goc[0][0] - x0) * k, (goc[0][1] - y0) * k],
    [(goc[1][0] - x0) * k, (goc[1][1] - y0) * k],
    [(goc[2][0] - x0) * k, (goc[2][1] - y0) * k],
    [(goc[3][0] - x0) * k, (goc[3][1] - y0) * k],
  ];

  // Point-in-convex-quad helper
  const pointInQuad = (px: number, py: number, q: QuadCorners): boolean => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i];
      const b = q[(i + 1) % 4];
      const cross = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
      if (Math.abs(cross) < 1e-6) continue;
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (sign !== s) return false;
    }
    return true;
  };

  const trongAnh = new Uint8Array(cw * ch);
  let trongAnhSum = 0;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (pointInQuad(x, y, tuGiac)) {
        trongAnh[y * cw + x] = 1;
        trongAnhSum++;
      }
    }
  }
  const trongAnhDilated = dilateMask(trongAnh, cw, ch, 7, 7);

  // Red stamp ink mask outside the photo: (a - 128 > 20) & (sac >= 168 | sac <= 6)
  const muc = new Uint8Array(cw * ch);
  for (let i = 0; i < cw * ch; i++) {
    if (trongAnhDilated[i]) continue;
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const [, aCv] = rgbToCvLab(r, g, b);
    const sac = rgbToCvHue(r, g, b);
    if (aCv - 128 > 20 && (sac >= 168 || sac <= 6)) {
      muc[i] = 1;
    }
  }

  const khoi = morphClose(
    morphClose(muc, cw, ch, 11, 11),
    cw,
    ch,
    11,
    11
  );
  const { labels, stats } = connectedComponentsWithStats8(khoi, cw, ch);
  const vong: Array<[number, number, number]> = [];

  for (let i = 1; i < stats.length; i++) {
    if (stats[i].area < 2500) continue;
    const pts: Point2D[] = [];
    for (let y = stats[i].top; y < stats[i].top + stats[i].height; y++) {
      for (let x = stats[i].left; x < stats[i].left + stats[i].width; x++) {
        if (labels[y * cw + x] === stats[i].label) {
          pts.push([x, y]);
        }
      }
    }
    let { hull: cung } = convexHullAndArea(pts);
    let tron: [number, number, number] | null = null;

    // Kasa circle fit: x^2 + y^2 + pa*x + pb*y + pc = 0
    for (let iter = 0; iter < 3; iter++) {
      if (cung.length < 6) break;
      let sx = 0,
        sy = 0,
        sxx = 0,
        syy = 0,
        sxy = 0,
        sz = 0,
        sxz = 0,
        syz = 0;
      const m = cung.length;
      for (const [px, py] of cung) {
        const z = -(px * px + py * py);
        sx += px;
        sy += py;
        sxx += px * px;
        syy += py * py;
        sxy += px * py;
        sz += z;
        sxz += px * z;
        syz += py * z;
      }

      // Solve 3x3 normal equations
      const M3 = [
        [sxx, sxy, sx],
        [sxy, syy, sy],
        [sx, sy, m],
      ];
      const V3 = [sxz, syz, sz];
      // Cramer / Gaussian 3x3
      const det3 = (mat: number[][]) =>
        mat[0][0] * (mat[1][1] * mat[2][2] - mat[1][2] * mat[2][1]) -
        mat[0][1] * (mat[1][0] * mat[2][2] - mat[1][2] * mat[2][0]) +
        mat[0][2] * (mat[1][0] * mat[2][1] - mat[1][1] * mat[2][0]);

      const d = det3(M3);
      if (Math.abs(d) < 1e-9) break;
      const pa =
        det3([
          [V3[0], M3[0][1], M3[0][2]],
          [V3[1], M3[1][1], M3[1][2]],
          [V3[2], M3[2][1], M3[2][2]],
        ]) / d;
      const pb =
        det3([
          [M3[0][0], V3[0], M3[0][2]],
          [M3[1][0], V3[1], M3[1][2]],
          [M3[2][0], V3[2], M3[2][2]],
        ]) / d;
      const pc =
        det3([
          [M3[0][0], M3[0][1], V3[0]],
          [M3[1][0], M3[1][1], V3[1]],
          [M3[2][0], M3[2][1], V3[2]],
        ]) / d;

      const cx = -pa / 2;
      const cy = -pb / 2;
      const r2 = cx * cx + cy * cy - pc;
      if (r2 <= 0) break;
      const r = Math.sqrt(r2);
      const lech = cung.map(([px, py]) => Math.abs(Math.hypot(px - cx, py - cy) - r));
      const maxLech = Math.max(...lech);
      if (maxLech < 0.05 * r) {
        tron = [cx, cy, r];
        break;
      }
      const p80 = Math.max(0.05 * r, percentileOfArray(lech, 80));
      cung = cung.filter((_, idx) => lech[idx] < p80);
    }

    if (!tron || !(0.4 * 300 <= tron[2] && tron[2] <= 1.0 * 300)) continue;

    // Check overlap with `trongAnh`
    let overlap = 0;
    const [tcx, tcy, tr] = tron;
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        if (trongAnh[y * cw + x] && Math.hypot(x - tcx, y - tcy) <= tr) {
          overlap++;
        }
      }
    }
    if (overlap < 0.01 * Math.max(1, trongAnhSum)) continue;
    vong.push([tcx / k + x0, tcy / k + y0, tr / k]);
  }

  return vong;
}

/**
 * Port of `xoa_dau_do(thang, M, vong, mat)` from `anh_the.py`:
 * Removes red stamp ink inside the detected stamp circle(s) on the deskewed card while protecting the face ellipse.
 */
function xoaDauDoOnCanvas(
  thangCanvas: HTMLCanvasElement,
  fwdH: Float64Array,
  vong: Array<[number, number, number]>,
  hopMat: [number, number, number, number]
): boolean {
  if (vong.length === 0) return false;
  const w = thangCanvas.width;
  const h = thangCanvas.height;
  const ctx = thangCanvas.getContext('2d');
  if (!ctx) return false;

  const imgData = ctx.getImageData(0, 0, w, h);
  const rgba = imgData.data;

  // Build stamp circle mask on `thangCanvas`, excluding face protection ellipse
  const [mx0, my0, mx1, my1] = hopMat;
  const faceCx = (mx0 + mx1) / 2;
  const faceCy = (my0 + my1) / 2;
  const faceRx = Math.max(1, 0.46 * (mx1 - mx0));
  const faceRy = Math.max(1, 0.56 * (my1 - my0));

  // Transform stamp circle centers and radii into `thangCanvas`
  const warpedStamps = vong.map(([cx, cy, r]) => {
    const cPt = applyHomographyPoint(fwdH, cx, cy);
    const rPt = applyHomographyPoint(fwdH, cx + r, cy);
    const wr = Math.hypot(rPt[0] - cPt[0], rPt[1] - cPt[1]) * 1.12;
    return [cPt[0], cPt[1], wr] as [number, number, number];
  });

  const vung = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Face protection ellipse
      const ex = (x - faceCx) / faceRx;
      const ey = (y - faceCy) / faceRy;
      if (ex * ex + ey * ey <= 1.0) continue;

      for (const [scx, scy, sr] of warpedStamps) {
        if (Math.hypot(x - scx, y - scy) <= sr) {
          vung[y * w + x] = 1;
          break;
        }
      }
    }
  }

  const lab = computeBlurredLabBuffer(rgba, w, h, 1.0);
  const matNaRaw = new Uint8Array(w * h);
  let redCount = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!vung[i]) continue;
      const r = rgba[i * 4];
      const g = rgba[i * 4 + 1];
      const b = rgba[i * 4 + 2];
      const a = lab[i * 3 + 1];
      const sac = rgbToCvHue(r, g, b);

      // Local neighborhood median `a` check for thin red ink on blue backdrop
      const xLeft = Math.max(0, x - 6);
      const xRight = Math.min(w - 1, x + 6);
      const yUp = Math.max(0, y - 6);
      const yDown = Math.min(h - 1, y + 6);
      const localA = medianOfArray([
        lab[(y * w + xLeft) * 3 + 1],
        lab[(y * w + xRight) * 3 + 1],
        lab[(yUp * w + x) * 3 + 1],
        lab[(yDown * w + x) * 3 + 1],
      ]);

      const isBrightRed = a - 128 > 18 && (sac >= 168 || sac <= 6);
      const isThinRedStroke = a - localA > 4.5 && a - 128 > 6;
      if (isBrightRed || isThinRedStroke) {
        matNaRaw[i] = 1;
        redCount++;
      }
    }
  }

  if (redCount < 0.0005 * w * h) return false;

  const matNa = dilateMask(morphClose(matNaRaw, w, h, 3, 3), w, h, 5, 5);
  for (let i = 0; i < w * h; i++) {
    if (!vung[i]) matNa[i] = 0;
  }

  // Multi-pass smooth material-aware inpainting (`_lap_muot`) from clean neighboring pixels
  const clean = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const L = lab[i * 3];
    const a = lab[i * 3 + 1];
    const b = lab[i * 3 + 2];
    const isSkin = L >= 100 && a - 128 > 8 && b - 128 > 10;
    if (!matNa[i] && !isSkin) clean[i] = 1;
  }

  let radius = 3;
  const remaining = new Uint8Array(matNa);
  for (let pass = 0; pass < 6; pass++) {
    let anyLeft = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (!remaining[idx]) continue;

        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let sumW = 0;

        for (let dy = -radius; dy <= radius; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const nIdx = yy * w + xx;
            if (!clean[nIdx]) continue;
            const dist2 = dx * dx + dy * dy;
            const wgt = Math.exp(-dist2 / (2 * radius * radius));
            sumR += rgba[nIdx * 4] * wgt;
            sumG += rgba[nIdx * 4 + 1] * wgt;
            sumB += rgba[nIdx * 4 + 2] * wgt;
            sumW += wgt;
          }
        }

        if (sumW > 0.15) {
          rgba[idx * 4] = Math.round(sumR / sumW);
          rgba[idx * 4 + 1] = Math.round(sumG / sumW);
          rgba[idx * 4 + 2] = Math.round(sumB / sumW);
          remaining[idx] = 0;
          clean[idx] = 1;
        } else {
          anyLeft = true;
        }
      }
    }
    if (!anyLeft) break;
    radius *= 2;
  }

  ctx.putImageData(imgData, 0, 0);
  return true;
}

/**
 * Port of `mau_giay_quanh(nen, goc, vong)` from `anh_the.py`:
 * Samples the RGB color of the white paper ring (`1.08x .. 1.24x`) immediately surrounding the ID photo.
 */
export function mauGiayQuanh(
  img: HTMLImageElement | HTMLCanvasElement,
  goc: QuadCorners,
  vong?: Array<[number, number, number]>
): [number, number, number] | null {
  const W = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const H = img instanceof HTMLImageElement ? img.naturalHeight : img.height;

  const tamX = (goc[0][0] + goc[1][0] + goc[2][0] + goc[3][0]) / 4;
  const tamY = (goc[0][1] + goc[1][1] + goc[2][1] + goc[3][1]) / 4;

  const scaleQuad = (s: number): QuadCorners => [
    [tamX + (goc[0][0] - tamX) * s, tamY + (goc[0][1] - tamY) * s],
    [tamX + (goc[1][0] - tamX) * s, tamY + (goc[1][1] - tamY) * s],
    [tamX + (goc[2][0] - tamX) * s, tamY + (goc[2][1] - tamY) * s],
    [tamX + (goc[3][0] - tamX) * s, tamY + (goc[3][1] - tamY) * s],
  ];

  const outerQ = scaleQuad(1.24);
  const innerQ = scaleQuad(1.08);

  const xs = outerQ.map((p) => p[0]);
  const ys = outerQ.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const x1 = Math.min(W, Math.ceil(Math.max(...xs)));
  const y1 = Math.min(H, Math.ceil(Math.max(...ys)));
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw <= 4 || bh <= 4) return null;

  const sw = Math.min(bw, 220);
  const sh = Math.max(4, Math.round((bh * sw) / bw));
  const scale = sw / bw;

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, x0, y0, bw, bh, 0, 0, sw, sh);
  const { data: rgba } = ctx.getImageData(0, 0, sw, sh);

  const pointInQuad = (px: number, py: number, q: QuadCorners): boolean => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i];
      const b = q[(i + 1) % 4];
      const cross = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
      if (Math.abs(cross) < 1e-6) continue;
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (sign !== s) return false;
    }
    return true;
  };

  const samples: Array<{ L: number; r: number; g: number; b: number }> = [];
  for (let sy = 0; sy < sh; sy++) {
    const gy = sy / scale + y0;
    for (let sx = 0; sx < sw; sx++) {
      const gx = sx / scale + x0;
      if (!pointInQuad(gx, gy, outerQ) || pointInQuad(gx, gy, innerQ)) continue;
      if (
        vong &&
        vong.some(([cx, cy, r]) => Math.hypot(gx - cx, gy - cy) <= 1.15 * r)
      ) {
        continue;
      }
      const idx = (sy * sw + sx) * 4;
      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];
      const [L, a, bCh] = rgbToCvLab(r, g, b);
      if (Math.hypot(a - 128, bCh - 128) < 12 && L > 120) {
        samples.push({ L, r, g, b });
      }
    }
  }

  if (samples.length < 40) return null;
  const p75 = percentileOfArray(
    samples.map((s) => s.L),
    75
  );
  const topSamples = samples.filter((s) => s.L >= p75);
  if (topSamples.length === 0) return null;

  return [
    medianOfArray(topSamples.map((s) => s.r)),
    medianOfArray(topSamples.map((s) => s.g)),
    medianOfArray(topSamples.map((s) => s.b)),
  ];
}

/**
 * Port of `hoan_thien(anh, kich_thuoc, muc, trang_giay, mat)` from `anh_the.py`:
 * Beautifies the 354x472 ID photo according to `muc` (0 = none, 1 = light, 2 = medium [default], 3 = strong):
 * 1) Mild denoising (muc >= 2)
 * 2) White-balance & brightness normalization using surrounding white paper (`trang_giay`)
 * 3) LAB L-channel 0.5%..99.5% contrast stretching
 * 4) Skin luminance gamma curve lift if face is dark (`40 < da < 150`)
 * 5) Subtle chroma boost (`+0.04 * manh`)
 * 6) Detail-preserving Unsharp Mask (`|chi_tiet| >= 1.5`, gain `0.2 + 0.3 * muc`)
 */
export function hoanThienOnCanvas(
  ctx: CanvasRenderingContext2D,
  rong: number,
  cao: number,
  muc: 0 | 1 | 2 | 3 = 2,
  trangGiay?: [number, number, number] | null,
  matTiLe?: [number, number, number, number] | null
): void {
  if (muc <= 0) return;
  const manh = muc === 1 ? 0.5 : muc === 2 ? 0.8 : 1.0;

  const imgData = ctx.getImageData(0, 0, rong, cao);
  const data = imgData.data;
  const n = rong * cao;

  // 1) Mild edge-preserving bilateral denoise for muc >= 2
  if (muc >= 2) {
    const copy = new Uint8ClampedArray(data);
    const thresh = muc === 2 ? 14 : 20;
    for (let y = 1; y < cao - 1; y++) {
      for (let x = 1; x < rong - 1; x++) {
        const cIdx = (y * rong + x) * 4;
        const cr = copy[cIdx];
        const cg = copy[cIdx + 1];
        const cb = copy[cIdx + 2];
        let sr = cr * 4;
        let sg = cg * 4;
        let sb = cb * 4;
        let sw = 4;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nIdx = ((y + dy) * rong + (x + dx)) * 4;
            const nr = copy[nIdx];
            const ng = copy[nIdx + 1];
            const nb = copy[nIdx + 2];
            if (
              Math.abs(nr - cr) + Math.abs(ng - cg) + Math.abs(nb - cb) <
              thresh * 3
            ) {
              sr += nr;
              sg += ng;
              sb += nb;
              sw += 1;
            }
          }
        }
        data[cIdx] = sr / sw;
        data[cIdx + 1] = sg / sw;
        data[cIdx + 2] = sb / sw;
      }
    }
  }

  // 2) White balance & brightness scaling according to surrounding white paper (`trang_giay`)
  if (trangGiay && trangGiay[0] > 10 && trangGiay[1] > 10 && trangGiay[2] > 10) {
    const tb = (trangGiay[0] + trangGiay[1] + trangGiay[2]) / 3;
    const gainFactor = Math.max(0.9, Math.min(1.3, 240 / tb));
    let scaleR =
      1 +
      manh *
        (Math.max(0.9, Math.min(1.12, tb / trangGiay[0])) * gainFactor - 1);
    let scaleG =
      1 +
      manh *
        (Math.max(0.9, Math.min(1.12, tb / trangGiay[1])) * gainFactor - 1);
    let scaleB =
      1 +
      manh *
        (Math.max(0.9, Math.min(1.12, tb / trangGiay[2])) * gainFactor - 1);

    const maxVals: number[] = [];
    for (let i = 0; i < n; i += 4) {
      const idx = i * 4;
      maxVals.push(
        Math.max(
          data[idx] * scaleR,
          data[idx + 1] * scaleG,
          data[idx + 2] * scaleB
        )
      );
    }
    const dinh = percentileOfArray(maxVals, 99.5);
    if (dinh > 252) {
      const clampFactor = 252 / dinh;
      scaleR *= clampFactor;
      scaleG *= clampFactor;
      scaleB *= clampFactor;
    }

    for (let i = 0; i < n; i++) {
      const idx = i * 4;
      data[idx] = Math.max(0, Math.min(255, Math.round(data[idx] * scaleR)));
      data[idx + 1] = Math.max(
        0,
        Math.min(255, Math.round(data[idx + 1] * scaleG))
      );
      data[idx + 2] = Math.max(
        0,
        Math.min(255, Math.round(data[idx + 2] * scaleB))
      );
    }
  }

  // Convert to LAB for steps 3, 4, 5
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  const lSample: number[] = [];

  for (let i = 0; i < n; i++) {
    const idx = i * 4;
    const [lVal, aVal, bVal] = rgbToCvLab(
      data[idx],
      data[idx + 1],
      data[idx + 2]
    );
    L[i] = lVal;
    A[i] = aVal;
    B[i] = bVal;
    if (i % 3 === 0) lSample.push(lVal);
  }

  // 3) Kéo giãn tương phản nhẹ (0.5% .. 99.5% percentiles of L)
  const lo = percentileOfArray(lSample, 0.5);
  const hi = percentileOfArray(lSample, 99.5);
  if (hi - lo > 40) {
    const loMoi = Math.min(lo, 10.0);
    const hiMoi = Math.max(hi, Math.min(250.0, hi + 12 * manh));
    const scaleL = (hiMoi - loMoi) / (hi - lo);
    for (let i = 0; i < n; i++) {
      L[i] = (L[i] - lo) * scaleL + loMoi;
    }
  }

  // 4) Da mặt bị tối thì nâng vùng trung gian lên (gamma curve on L)
  if (matTiLe) {
    const [fx0, fy0, fx1, fy1] = matTiLe;
    const cxm = ((fx0 + fx1) / 2) * rong;
    const cym = ((fy0 + fy1) / 2) * cao;
    const bw = (fx1 - fx0) * rong;
    const bh = (fy1 - fy0) * cao;
    const xStart = Math.max(0, Math.floor(cxm - bw / 4));
    const xEnd = Math.min(rong, Math.floor(cxm + bw / 4));
    const yStart = Math.max(0, Math.floor(cym - bh / 4));
    const yEnd = Math.min(cao, Math.floor(cym + bh / 4));

    const skinL: number[] = [];
    for (let yy = yStart; yy < yEnd; yy++) {
      for (let xx = xStart; xx < xEnd; xx++) {
        skinL.push(L[yy * rong + xx]);
      }
    }
    if (skinL.length > 50) {
      const da = medianOfArray(skinL);
      if (da > 40 && da < 150) {
        const dich = da + manh * 0.6 * (150 - da);
        const gamma = Math.log(dich / 255) / Math.log(da / 255);
        for (let i = 0; i < n; i++) {
          const norm = Math.max(0, Math.min(255, L[i])) / 255;
          L[i] = 255 * Math.pow(norm, gamma);
        }
      }
    }
  }

  // 5) Màu tươi hơn một chút (+0.04 * manh) & convert back to RGB
  const chromaScale = 1 + 0.04 * manh;
  for (let i = 0; i < n; i++) {
    const lClamped = Math.max(0, Math.min(255, L[i]));
    const aClamped = Math.max(
      0,
      Math.min(255, 128 + (A[i] - 128) * chromaScale)
    );
    const bClamped = Math.max(
      0,
      Math.min(255, 128 + (B[i] - 128) * chromaScale)
    );
    const [r, g, b] = cvLabToRgb(lClamped, aClamped, bClamped);
    const idx = i * 4;
    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
  }

  // 6) Tăng nét (Unsharp Mask sigma=1.0, threshold |chi_tiet| >= 1.5, gain = 0.2 + 0.3 * muc)
  const srcCopy = new Uint8ClampedArray(data);
  const gain = 0.2 + 0.3 * muc;
  const gKernel = [1 / 16, 2 / 16, 1 / 16, 2 / 16, 4 / 16, 2 / 16, 1 / 16, 2 / 16, 1 / 16];

  for (let y = 1; y < cao - 1; y++) {
    for (let x = 1; x < rong - 1; x++) {
      const idx = (y * rong + x) * 4;
      for (let c = 0; c < 3; c++) {
        let blurVal = 0;
        let kIdx = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            blurVal +=
              srcCopy[((y + dy) * rong + (x + dx)) * 4 + c] * gKernel[kIdx++];
          }
        }
        const origVal = srcCopy[idx + c];
        const chiTiet = origVal - blurVal;
        if (Math.abs(chiTiet) >= 1.5) {
          data[idx + c] = Math.max(
            0,
            Math.min(255, Math.round(origVal + gain * chiTiet))
          );
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

// ============================================================================
// FACE DETECTION (MediaPipe + Multi-scale ROI Candidate Pre-Locator)
// ============================================================================

function isHumanSkinPixel(r: number, g: number, b: number): boolean {
  if (r > 145 && r - g > 70 && g < 95) return false; // Exclude red stamp ink
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return (
    y >= 55 &&
    y <= 242 &&
    cr >= 134 &&
    cr <= 172 &&
    cb >= 80 &&
    cb <= 128 &&
    r > g &&
    r > b &&
    r - g >= 10
  );
}

function findSkinHairFaceCandidates(
  img: HTMLImageElement,
  imgW: number,
  imgH: number
): DetectedFaceBox[] {
  const maxDim = 320;
  const scale = Math.min(1, maxDim / Math.max(imgW, imgH));
  const sw = Math.max(32, Math.round(imgW * scale));
  const sh = Math.max(32, Math.round(imgH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  ctx.drawImage(img, 0, 0, sw, sh);
  const { data } = ctx.getImageData(0, 0, sw, sh);

  const skinMask = new Uint8Array(sw * sh);
  const hairMask = new Uint8Array(sw * sh);
  const blueBackdropMask = new Uint8Array(sw * sh);

  for (let i = 0; i < sw * sh; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (isHumanSkinPixel(r, g, b)) skinMask[i] = 1;
    if (lum >= 12 && lum <= 80 && Math.max(r, g, b) - Math.min(r, g, b) < 42) {
      hairMask[i] = 1;
    }
    if ((b > r + 22 && b > 100) || (g > r + 18 && b > r + 18 && b > 95)) {
      blueBackdropMask[i] = 1;
    }
  }

  const visited = new Uint8Array(sw * sh);
  const candidates: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    score: number;
  }> = [];

  for (let y = 2; y < sh - 2; y++) {
    for (let x = 2; x < sw - 2; x++) {
      const startIdx = y * sw + x;
      if (!skinMask[startIdx] || visited[startIdx]) continue;

      const queue = [startIdx];
      visited[startIdx] = 1;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let skinCount = 0;

      while (queue.length > 0) {
        const curr = queue.pop()!;
        const cy = Math.floor(curr / sw);
        const cx = curr % sw;
        skinCount++;

        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const ny = cy + dy;
            const nx = cx + dx;
            if (nx >= 0 && nx < sw && ny >= 0 && ny < sh) {
              const nIdx = ny * sw + nx;
              if (skinMask[nIdx] && !visited[nIdx]) {
                visited[nIdx] = 1;
                queue.push(nIdx);
              }
            }
          }
        }
      }

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (
        skinCount < 14 ||
        bw < 4 ||
        bh < 5 ||
        bw > sw * 0.75 ||
        bh > sh * 0.75
      ) {
        continue;
      }

      const faceW = bw;
      const faceH = Math.min(Math.round(bw * 1.25), bh);
      const aspect = faceW / Math.max(1, faceH);
      if (aspect < 0.42 || aspect > 1.55) continue;

      const hairY0 = Math.max(0, Math.round(minY - faceH * 0.45));
      const hairY1 = Math.min(sh - 1, Math.round(minY + faceH * 0.45));
      const hairX0 = Math.max(0, Math.round(minX - faceW * 0.35));
      const hairX1 = Math.min(sw - 1, Math.round(maxX + faceW * 0.35));
      let hairPixels = 0;
      let hairArea = 0;
      for (let hy = hairY0; hy <= hairY1; hy++) {
        for (let hx = hairX0; hx <= hairX1; hx++) {
          hairArea++;
          if (hairMask[hy * sw + hx]) hairPixels++;
        }
      }
      const hairRatio = hairPixels / Math.max(1, hairArea);
      if (hairRatio < 0.08) continue;

      const bgY0 = Math.max(0, Math.round(minY - faceH * 0.5));
      const bgY1 = Math.min(sh - 1, Math.round(minY + faceH * 1.1));
      const bgX0 = Math.max(0, Math.round(minX - faceW * 0.75));
      const bgX1 = Math.min(sw - 1, Math.round(maxX + faceW * 0.75));
      let bluePixels = 0;
      let bgArea = 0;
      for (let by = bgY0; by <= bgY1; by++) {
        for (let bx = bgX0; bx <= bgX1; bx++) {
          bgArea++;
          if (blueBackdropMask[by * sw + bx]) bluePixels++;
        }
      }
      const blueRatio = bluePixels / Math.max(1, bgArea);

      const centerBias =
        1 -
        0.3 *
          Math.hypot(
            (minX + faceW / 2 - sw / 2) / sw,
            (minY + faceH / 2 - sh / 2) / sh
          );

      const score =
        skinCount *
        (0.5 + Math.min(0.6, hairRatio * 2)) *
        (1 + blueRatio * 3.5) *
        centerBias;

      candidates.push({
        x: minX / scale,
        y: minY / scale,
        w: faceW / scale,
        h: faceH / scale,
        score,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 6).map((c, idx) => {
    const eyeY = c.y + c.h * 0.38;
    return {
      id: idx,
      x: c.x,
      y: c.y,
      width: c.w,
      height: c.h,
      confidence: 0.75,
      keypoints: [
        { x: c.x + c.w * 0.32, y: eyeY, name: 'right_eye' },
        { x: c.x + c.w * 0.68, y: eyeY, name: 'left_eye' },
      ],
      suggestedTiltDeg: 0,
    };
  });
}

async function runMediaPipeOnRoi(
  mpDetector: FaceDetector,
  img: HTMLImageElement | HTMLCanvasElement,
  roiX: number,
  roiY: number,
  roiW: number,
  roiH: number
): Promise<DetectedFaceBox[]> {
  const targetSize = 512;
  const scale = Math.min(1.5, targetSize / Math.max(roiW, roiH));
  const cw = Math.max(64, Math.round(roiW * scale));
  const ch = Math.max(64, Math.round(roiH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  ctx.drawImage(img, roiX, roiY, roiW, roiH, 0, 0, cw, ch);
  const res = mpDetector.detect(canvas);
  if (!res?.detections || res.detections.length === 0) return [];

  return res.detections.map((det, idx) => {
    const bb = det.boundingBox!;
    const fx = roiX + bb.originX / scale;
    const fy = roiY + bb.originY / scale;
    const fw = bb.width / scale;
    const fh = bb.height / scale;

    const kps = (det.keypoints || []).map((kp, kIdx) => ({
      x: roiX + (kp.x * cw) / scale,
      y: roiY + (kp.y * ch) / scale,
      name:
        kIdx === 0
          ? 'right_eye'
          : kIdx === 1
            ? 'left_eye'
            : kIdx === 2
              ? 'nose'
              : kIdx === 3
                ? 'mouth'
                : `kp_${kIdx}`,
    }));

    let tilt = 0;
    if (kps.length >= 2) {
      const dy = kps[1].y - kps[0].y;
      const dx = kps[1].x - kps[0].x;
      if (Math.abs(dx) > 3) {
        const raw = -(Math.atan2(dy, dx) * 180) / Math.PI;
        if (Math.abs(raw) <= 25) tilt = Number(raw.toFixed(1));
      }
    }

    return {
      id: idx,
      x: fx,
      y: fy,
      width: fw,
      height: fh,
      confidence: det.categories?.[0]?.score ?? 0.9,
      keypoints: kps,
      suggestedTiltDeg: tilt,
    };
  });
}

function quadToPhotoCardRect(
  corners: QuadCorners,
  method: AutoCropMethod
): {
  x: number;
  y: number;
  width: number;
  height: number;
  angleDeg: number;
  method: AutoCropMethod;
  corners: QuadCorners;
} {
  const [tl, tr, br, bl] = corners;
  const width = Math.max(
    Math.hypot(tr[0] - tl[0], tr[1] - tl[1]),
    Math.hypot(br[0] - bl[0], br[1] - bl[1])
  );
  const height = Math.max(
    Math.hypot(bl[0] - tl[0], bl[1] - tl[1]),
    Math.hypot(br[0] - tr[0], br[1] - tr[1])
  );
  const cx = (tl[0] + tr[0] + br[0] + bl[0]) / 4;
  const cy = (tl[1] + tr[1] + br[1] + bl[1]) / 4;
  const angleDeg = Number(
    ((-Math.atan2(tr[1] - tl[1], tr[0] - tl[0]) * 180) / Math.PI).toFixed(1)
  );
  return {
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
    angleDeg,
    method,
    corners,
  };
}

// ============================================================================
// MAIN PIPELINE (EXACT PORT OF xu_ly FROM anh_the.py: A -> B -> A2 -> C)
// ============================================================================

/**
 * Runs the complete 3x4 ID photo extraction pipeline from `anh_the.py`:
 *   A.  Tìm khuôn mặt -> lần theo phông nền quanh đầu (`tim_khung_theo_phong`). Chỉ tin ngay khi `do_mau >= PHONG_CO_MAU` (16.0).
 *   B.  Tìm tờ giấy ảnh theo đường mép trên nền trơn (`tim_to_anh`) -> nắn thẳng -> xác nhận khuôn mặt -> bỏ viền giấy (`khung_trong_to`).
 *   A2. Tìm 3 đường thẳng dài (trái, phải, trên) quanh từng khuôn mặt ứng viên (`tim_khung_theo_mep`) cho ảnh phông trắng dán trên hồ sơ.
 *   C.  Cắt khung 3:4 quanh khuôn mặt (`cat_theo_mat`), không nắn (đánh dấu "XEM").
 */
export async function detectFacesInImage(img: HTMLImageElement): Promise<{
  faces: DetectedFaceBox[];
  engineUsed: 'method_a' | 'method_b' | 'method_a2' | 'method_c';
  detectedCardRect: {
    x: number;
    y: number;
    width: number;
    height: number;
    angleDeg?: number;
    method?: AutoCropMethod;
    corners?: QuadCorners;
  } | null;
  recommendedConfig: CropTransformConfig;
}> {
  const imgW = img.naturalWidth || img.width;
  const imgH = img.naturalHeight || img.height;

  const detectedFaces: DetectedFaceBox[] = [];
  const skinCandidates = findSkinHairFaceCandidates(img, imgW, imgH);
  const mpDetector = await getMediaPipeFaceDetector();

  if (mpDetector) {
    try {
      const fullPass = await runMediaPipeOnRoi(
        mpDetector,
        img,
        0,
        0,
        imgW,
        imgH
      );
      detectedFaces.push(...fullPass);

      if (detectedFaces.length === 0) {
        for (const cand of skinCandidates.slice(0, 3)) {
          const padW = cand.width * 2.2;
          const padH = cand.height * 2.6;
          const rx = Math.max(0, cand.x - padW);
          const ry = Math.max(0, cand.y - padH * 0.8);
          const rw = Math.min(imgW - rx, cand.width + padW * 2);
          const rh = Math.min(imgH - ry, cand.height + padH * 2);
          const roiFaces = await runMediaPipeOnRoi(
            mpDetector,
            img,
            rx,
            ry,
            rw,
            rh
          );
          if (roiFaces.length > 0) {
            detectedFaces.push(...roiFaces);
            break;
          }
        }
      }

      if (detectedFaces.length === 0) {
        const cx = imgW * 0.2;
        const cy = imgH * 0.2;
        const cw = imgW * 0.6;
        const ch = imgH * 0.6;
        const centerFaces = await runMediaPipeOnRoi(
          mpDetector,
          img,
          cx,
          cy,
          cw,
          ch
        );
        if (centerFaces.length > 0) {
          detectedFaces.push(...centerFaces);
        }
      }
    } catch (err) {
      console.warn('MediaPipe detection error:', err);
    }
  }

  if (detectedFaces.length === 0 && skinCandidates.length > 0) {
    detectedFaces.push(...skinCandidates);
  }

  // Sort candidate faces by confidence & reasonable size (up to SO_MAT_THU = 6)
  detectedFaces.sort(
    (a, b) =>
      b.confidence * Math.sqrt(b.width * b.height) -
      a.confidence * Math.sqrt(a.width * a.height)
  );
  const candidateFaces = detectedFaces.slice(0, SO_MAT_THU);

  const buildFinalResult = (
    corners: QuadCorners,
    faceBox: DetectedFaceBox | null,
    method: AutoCropMethod,
    description: string,
    needsReview: boolean
  ) => {
    const cardRect = quadToPhotoCardRect(corners, method);
    if (faceBox) {
      faceBox.photoCardRect = cardRect;
    }

    const vongDau = timVongDau(img, corners);
    const trangGiay = mauGiayQuanh(img, corners, vongDau);

    let normalizedFaceInCard: [number, number, number, number] | undefined;
    if (faceBox) {
      const fwdH = computeHomographyMatrix(
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
        corners
      );
      const p0 = applyHomographyPoint(fwdH, faceBox.x, faceBox.y);
      const p1 = applyHomographyPoint(
        fwdH,
        faceBox.x + faceBox.width,
        faceBox.y + faceBox.height
      );
      if (Math.abs(p1[0] - p0[0]) > 0.2) {
        normalizedFaceInCard = [
          Math.max(0, Math.min(1, p0[0])),
          Math.max(0, Math.min(1, p0[1])),
          Math.max(0, Math.min(1, p1[0])),
          Math.max(0, Math.min(1, p1[1])),
        ];
      }
    }

    return {
      faces: detectedFaces,
      engineUsed: (method === 'A'
        ? 'method_a'
        : method === 'B'
          ? 'method_b'
          : method === 'A2'
            ? 'method_a2'
            : 'method_c') as 'method_a' | 'method_b' | 'method_a2' | 'method_c',
      detectedCardRect: cardRect,
      recommendedConfig: {
        centerX: cardRect.x + cardRect.width / 2,
        centerY: cardRect.y + cardRect.height / 2,
        scale: 1,
        baseCropHeight: Math.max(24, cardRect.height),
        rotationDeg: cardRect.angleDeg,
        flipH: false,
        brightness: 100,
        contrast: 100,
        sharpen: true,
        aspectRatio: TI_LE,
        methodUsed: method,
        methodDescription: description,
        needsReview,
        quadCorners: corners,
        enhanceLevel: 2 as const,
        removeRedStamp: true,
        borderTrimRatio: DEFAULT_BO_VIEN,
        detectedStamps: vongDau,
        surroundingPaperRgb: trangGiay,
        normalizedFaceInCard,
      },
    };
  };

  // --- STEP A: Tìm khuôn mặt -> lần theo phông nền quanh đầu (`tim_khung_theo_phong`).
  // Chỉ tin ngay khi phông có màu (`do_mau >= PHONG_CO_MAU` = 16.0).
  let khungTot: {
    face: DetectedFaceBox;
    corners: QuadCorners;
    doMau: number;
  } | null = null;

  for (const face of candidateFaces) {
    const kq = timKhungTheoPhong(img, face);
    if (kq) {
      khungTot = { face, corners: kq.corners, doMau: kq.doMau };
      break;
    }
  }

  if (khungTot && khungTot.doMau >= PHONG_CO_MAU) {
    return buildFinalResult(
      khungTot.corners,
      khungTot.face,
      'A',
      'Cách A: Lần phông nền có màu quanh đầu → Lấy mép trên & 2 mép bên → Nắn thẳng 3:4',
      false
    );
  }

  // --- STEP B: Tìm tờ giấy ảnh theo đường mép trên nền trơn (`tim_to_anh`) -> nắn thẳng,
  // xoay đúng chiều (`xoay_tam_anh`) -> xác nhận có khuôn mặt bên trong -> bỏ viền giấy (`khung_trong_to`).
  const cacTo = timToAnh(img).slice(0, 4);
  for (const rawGocTo of cacTo) {
    // Permutation of corners for 0°, 90° CW, 180°, 270° CW (matches xoay_tam_anh in anh_the.py)
    const d01 = Math.hypot(
      rawGocTo[1][0] - rawGocTo[0][0],
      rawGocTo[1][1] - rawGocTo[0][1]
    );
    const d03 = Math.hypot(
      rawGocTo[3][0] - rawGocTo[0][0],
      rawGocTo[3][1] - rawGocTo[0][1]
    );
    // Start with portrait orientation first (like `if to.shape[1] > to.shape[0]: rotate_90` in anh_the.py)
    const baseQuad: QuadCorners =
      d01 > d03
        ? [rawGocTo[3], rawGocTo[0], rawGocTo[1], rawGocTo[2]]
        : rawGocTo;

    const rotations: QuadCorners[] = [
      baseQuad,
      [baseQuad[2], baseQuad[3], baseQuad[0], baseQuad[1]], // 180°
      [baseQuad[3], baseQuad[0], baseQuad[1], baseQuad[2]], // 90° CW
      [baseQuad[1], baseQuad[2], baseQuad[3], baseQuad[0]], // 90° CCW
    ];

    for (const gocTo of rotations) {
      const { canvas: toCanvas, invH } = nanThangQuadToCanvas(img, gocTo, null);
      const tw = toCanvas.width;
      const th = toCanvas.height;

      // Confirm a face exists inside `gocTo`
      let faceInSheet: {
        x: number;
        y: number;
        width: number;
        height: number;
        origFace: DetectedFaceBox | null;
      } | null = null;

      // 1) Check already-detected faces when rotation is near upright (0°)
      if (gocTo === baseQuad && d01 <= d03) {
        const fwdSheetH = computeHomographyMatrix(
          [
            [0, 0],
            [tw - 1, 0],
            [tw - 1, th - 1],
            [0, th - 1],
          ],
          gocTo
        );
        for (const f of candidateFaces) {
          const fcx = f.x + f.width / 2;
          const fcy = f.y + f.height / 2;
          const [ux, uy] = applyHomographyPoint(fwdSheetH, fcx, fcy);
          if (ux >= 0 && ux < tw && uy >= 0 && uy < th) {
            const [ulx, uly] = applyHomographyPoint(fwdSheetH, f.x, f.y);
            const [urx, ury] = applyHomographyPoint(
              fwdSheetH,
              f.x + f.width,
              f.y + f.height
            );
            const fwSheet = Math.abs(urx - ulx);
            const fhSheet = Math.abs(ury - uly);
            if (0.22 <= fwSheet / tw && fwSheet / tw <= MAT_RONG_MAX) {
              faceInSheet = {
                x: Math.min(ulx, urx),
                y: Math.min(uly, ury),
                width: fwSheet,
                height: fhSheet,
                origFace: f,
              };
              break;
            }
          }
        }
      }

      // 2) Run MediaPipe on the deskewed/rotated sheet (`xoay_tam_anh` in `anh_the.py`)
      if (!faceInSheet && mpDetector) {
        const sheetFaces = await runMediaPipeOnRoi(
          mpDetector,
          toCanvas,
          0,
          0,
          tw,
          th
        );
        for (const sf of sheetFaces) {
          if (0.22 <= sf.width / tw && sf.width / tw <= MAT_RONG_MAX) {
            faceInSheet = {
              x: sf.x,
              y: sf.y,
              width: sf.width,
              height: sf.height,
              origFace: null,
            };
            break;
          }
        }
      }

      if (!faceInSheet) continue;

      let gocTrong: QuadCorners | null = null;
      const kqPhong = timKhungTheoPhong(toCanvas, faceInSheet);
      if (kqPhong && kqPhong.doMau >= PHONG_CO_MAU) {
        gocTrong = kqPhong.corners;
      } else {
        const kqMep = timKhungTheoMep(toCanvas, faceInSheet);
        if (kqMep) {
          const trai = kqMep.corners[0][0];
          const phai = kqMep.corners[1][0];
          const tren = Math.min(kqMep.corners[0][1], kqMep.corners[1][1]);
          if (
            0.015 * tw < trai &&
            trai < 0.12 * tw &&
            0.88 * tw < phai &&
            phai < 0.985 * tw &&
            0.015 * th < tren &&
            tren < 0.12 * th
          ) {
            gocTrong = kqMep.corners;
          }
        }
        if (!gocTrong) {
          gocTrong = khungTrongTo(toCanvas, faceInSheet);
        }
      }

      const gocGlobal: QuadCorners = [
        applyHomographyPoint(invH, gocTrong[0][0], gocTrong[0][1]),
        applyHomographyPoint(invH, gocTrong[1][0], gocTrong[1][1]),
        applyHomographyPoint(invH, gocTrong[2][0], gocTrong[2][1]),
        applyHomographyPoint(invH, gocTrong[3][0], gocTrong[3][1]),
      ];

      return buildFinalResult(
        gocGlobal,
        faceInSheet.origFace || candidateFaces[0] || null,
        'B',
        'Cách B: Tìm tờ giấy ảnh theo đường mép trên nền trơn → Nắn thẳng, xoay đúng chiều & bỏ viền giấy',
        false
      );
    }
  }

  // --- STEP A2: Tìm ba đường thẳng dài (mép trái, phải, trên) quanh từng khuôn mặt ứng viên (`tim_khung_theo_mep`).
  let totMep: {
    score: number;
    corners: QuadCorners;
    face: DetectedFaceBox;
  } | null = null;

  for (const face of candidateFaces) {
    const kq = timKhungTheoMep(img, face);
    if (kq && (!totMep || kq.score > totMep.score)) {
      totMep = { score: kq.score, corners: kq.corners, face };
    }
  }

  if (totMep) {
    return buildFinalResult(
      totMep.corners,
      totMep.face,
      'A2',
      'Cách A2: Tìm 3 đường thẳng dài (mép trái, phải, trên) quanh khuôn mặt trên hồ sơ',
      false
    );
  }

  // Fallback: Phông nhạt màu mà không thấy mép tờ giấy lẫn 3 đường thẳng -> dùng khungTot và đánh dấu XEM
  if (khungTot) {
    return buildFinalResult(
      khungTot.corners,
      khungTot.face,
      'A',
      'Cách A (XEM): Phông nền nhạt màu, mép ảnh có thể chưa chuẩn',
      true
    );
  }

  // Fallback: Thấy tờ ảnh trên nền bàn nhưng không dò ra khuôn mặt -> cắt theo tờ ảnh lớn nhất và đánh dấu XEM
  if (cacTo.length > 0 && candidateFaces.length === 0) {
    return buildFinalResult(
      cacTo[0],
      null,
      'B',
      'Cách B (XEM): Cắt theo tờ ảnh nhưng không thấy rõ khuôn mặt, nên kiểm tra lại',
      true
    );
  }

  // --- STEP C: Cắt khung 3:4 quanh khuôn mặt (`cat_theo_mat`), không nắn (đánh dấu "XEM").
  const primaryFace = candidateFaces[0] || null;
  if (primaryFace) {
    const cornersC = catTheoMat(imgW, imgH, primaryFace);
    return buildFinalResult(
      cornersC,
      primaryFace,
      'C',
      'Cách C (XEM): Không tìm được mép ảnh thẻ, cắt khung 3:4 quanh khuôn mặt (không nắn)',
      true
    );
  }

  // Ultimate fallback when no face or card was found
  const fitH = Math.min(imgH, imgW / TI_LE) * 0.6;
  const fitW = fitH * TI_LE;
  const x0 = (imgW - fitW) / 2;
  const y0 = (imgH - fitH) / 2;
  const defaultQuad: QuadCorners = [
    [x0, y0],
    [x0 + fitW, y0],
    [x0 + fitW, y0 + fitH],
    [x0, y0 + fitH],
  ];
  return buildFinalResult(
    defaultQuad,
    null,
    'C',
    'Cách C (XEM): Không tìm thấy khuôn mặt, cắt khung 3:4 mặc định',
    true
  );
}

/**
 * Given a detected face bounding box (or stage result), calculates the 3:4 ID photo crop transform.
 */
export function computeIdCropConfigFromFace(
  imgWidth: number,
  imgHeight: number,
  face: DetectedFaceBox | null,
  aspectRatio: number = TI_LE,
  preferCardBoundary = true
): CropTransformConfig {
  if (face?.photoCardRect && preferCardBoundary) {
    const rect = face.photoCardRect;
    const adjustedH =
      Math.abs(aspectRatio - TI_LE) < 0.01
        ? rect.height
        : rect.width / aspectRatio;
    return {
      centerX: rect.x + rect.width / 2,
      centerY: rect.y + adjustedH / 2,
      scale: 1,
      baseCropHeight: Math.max(20, adjustedH),
      rotationDeg: rect.angleDeg || 0,
      flipH: false,
      brightness: 100,
      contrast: 100,
      sharpen: true,
      aspectRatio,
      methodUsed: rect.method || 'A',
      needsReview: false,
      quadCorners: rect.corners,
      enhanceLevel: 2,
      removeRedStamp: true,
      borderTrimRatio: DEFAULT_BO_VIEN,
    };
  }

  if (!face) {
    const fitH = Math.min(imgHeight, imgWidth / aspectRatio) * 0.5;
    return {
      centerX: imgWidth / 2,
      centerY: imgHeight / 2,
      scale: 1,
      baseCropHeight: Math.max(30, fitH),
      rotationDeg: 0,
      flipH: false,
      brightness: 100,
      contrast: 100,
      sharpen: true,
      aspectRatio,
      methodUsed: 'C',
      needsReview: true,
      enhanceLevel: 2,
      removeRedStamp: true,
      borderTrimRatio: DEFAULT_BO_VIEN,
    };
  }

  // Exact Method C (`cat_theo_mat`) framing from `anh_the.py`: MAT_RONG = 0.52, MAT_Y = 0.17
  const cornersC = catTheoMat(imgWidth, imgHeight, face);
  const wC = cornersC[1][0] - cornersC[0][0];
  const hC = cornersC[2][1] - cornersC[0][1];
  return {
    centerX: cornersC[0][0] + wC / 2,
    centerY: cornersC[0][1] + hC / 2,
    scale: 1,
    baseCropHeight: Math.max(24, hC),
    rotationDeg: 0,
    flipH: false,
    brightness: 100,
    contrast: 100,
    sharpen: true,
    aspectRatio,
    methodUsed: 'C',
    methodDescription:
      'Cách C (XEM): Cắt khung 3:4 quanh khuôn mặt (MAT_RONG=0.52, MAT_Y=0.17), không nắn',
    needsReview: true,
    quadCorners: cornersC,
    enhanceLevel: 2,
    removeRedStamp: true,
    borderTrimRatio: DEFAULT_BO_VIEN,
  };
}

/**
 * Helper to test Method B directly from the UI button.
 */
export function tryMethodB_TableColorBlockDeskew(
  img: HTMLImageElement,
  primaryFace: DetectedFaceBox | null
): {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  angleDeg: number;
  corners?: QuadCorners;
} | null {
  const sheets = timToAnh(img);
  if (sheets.length === 0) return null;
  const chosen = sheets[0];
  const rect = quadToPhotoCardRect(chosen, 'B');
  if (primaryFace && !primaryFace.photoCardRect) {
    primaryFace.photoCardRect = rect;
  }
  return {
    centerX: rect.x + rect.width / 2,
    centerY: rect.y + rect.height / 2,
    width: rect.width,
    height: rect.height,
    angleDeg: rect.angleDeg,
    corners: chosen,
  };
}

/**
 * Renders the final cropped, perspective-deskewed, stamp-cleaned, and beautified 3x4 ID photo:
 *   - Default output size: `354 x 472 px` (`3x4 cm @ 300 DPI`)
 *   - Border trim `bo_mep(thang, 0.012)`
 *   - Red stamp removal `xoa_dau_do` (when `config.removeRedStamp !== false`)
 *   - Beautification `hoan_thien` at level `muc = 0..3` (default `2` when `config.sharpen !== false`)
 */
export function renderCroppedIdPhotoToDataUrl(
  img: HTMLImageElement,
  config: CropTransformConfig,
  outputWidth = OUTPUT_3X4_WIDTH_PX
): string {
  const outputHeight =
    Math.abs(config.aspectRatio - TI_LE) < 0.01 &&
    outputWidth === OUTPUT_3X4_WIDTH_PX
      ? OUTPUT_3X4_HEIGHT_PX
      : Math.round(outputWidth / config.aspectRatio);

  // Use exact perspective warp (`nan_thang`) when `quadCorners` is present and user hasn't manually panned/zoomed away
  let workingCanvas: HTMLCanvasElement;

  if (config.quadCorners && Math.abs(config.scale - 1) < 0.01) {
    const { canvas: thangCanvas, fwdH } = nanThangQuadToCanvas(
      img,
      config.quadCorners,
      config.aspectRatio
    );

    // Optional red stamp removal (`xoa_dau_do`)
    if (
      config.removeRedStamp !== false &&
      config.detectedStamps &&
      config.detectedStamps.length > 0
    ) {
      const tw = thangCanvas.width;
      const th = thangCanvas.height;
      const nf = config.normalizedFaceInCard || [0.24, 0.17, 0.76, 0.69];
      const hopMat: [number, number, number, number] = [
        nf[0] * tw,
        nf[1] * th,
        nf[2] * tw,
        nf[3] * th,
      ];
      xoaDauDoOnCanvas(thangCanvas, fwdH, config.detectedStamps, hopMat);
    }

    workingCanvas = thangCanvas;
  } else {
    // Manual transform (centerX, centerY, scale, rotationDeg)
    const cropH = config.baseCropHeight / Math.max(0.08, config.scale);
    const cropW = cropH * config.aspectRatio;
    const rad = (config.rotationDeg * Math.PI) / 180;
    const cosR = Math.cos(-rad);
    const sinR = Math.sin(-rad);
    const hw = cropW / 2;
    const hh = cropH / 2;

    const rotPt = (dx: number, dy: number): Point2D => [
      config.centerX + dx * cosR - dy * sinR,
      config.centerY + dx * sinR + dy * cosR,
    ];

    const manualQuad: QuadCorners = [
      rotPt(-hw, -hh),
      rotPt(hw, -hh),
      rotPt(hw, hh),
      rotPt(-hw, hh),
    ];

    const { canvas: thangCanvas } = nanThangQuadToCanvas(
      img,
      manualQuad,
      config.aspectRatio
    );
    workingCanvas = thangCanvas;
  }

  // Apply border trim `bo_mep(thang, bo_vien)` (default 0.012 as in anh_the.py)
  const trimRatio =
    config.methodUsed === 'C' ? 0 : (config.borderTrimRatio ?? DEFAULT_BO_VIEN);
  const wSrc = workingCanvas.width;
  const hSrc = workingCanvas.height;
  const lx = Math.round(wSrc * trimRatio);
  const ly = Math.round(hSrc * trimRatio);
  const trimW = Math.max(8, wSrc - 2 * lx);
  const trimH = Math.max(8, hSrc - 2 * ly);

  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = outputWidth;
  finalCanvas.height = outputHeight;
  const ctx = finalCanvas.getContext('2d');
  if (!ctx) return '';

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outputWidth, outputHeight);

  if (
    config.brightness !== 100 ||
    config.contrast !== 100
  ) {
    ctx.filter = `brightness(${config.brightness}%) contrast(${config.contrast}%)`;
  }

  if (config.flipH) {
    ctx.save();
    ctx.translate(outputWidth, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(
      workingCanvas,
      lx,
      ly,
      trimW,
      trimH,
      0,
      0,
      outputWidth,
      outputHeight
    );
    ctx.restore();
  } else {
    ctx.drawImage(
      workingCanvas,
      lx,
      ly,
      trimW,
      trimH,
      0,
      0,
      outputWidth,
      outputHeight
    );
  }
  ctx.filter = 'none';

  // Apply `hoan_thien` beautification (muc 0..3, default 2 when sharpen is enabled)
  const muc: 0 | 1 | 2 | 3 =
    config.sharpen === false ? 0 : (config.enhanceLevel ?? 2);
  if (muc > 0) {
    hoanThienOnCanvas(
      ctx,
      outputWidth,
      outputHeight,
      muc,
      config.surroundingPaperRgb,
      config.normalizedFaceInCard
    );
  }

  return finalCanvas.toDataURL('image/jpeg', 0.95);
}

/**
 * Loads a File into an HTMLImageElement.
 */
export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không thể đọc file ảnh'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Định dạng ảnh không hợp lệ'));
      img.onload = () => resolve(img);
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Automatic 1-step A -> B -> A2 -> C pipeline + 354x472 px (3x4 cm @ 300 DPI) + hoan_thien (muc 2) from any File.
 */
export async function autoCropFileWithFaceAI(
  file: File,
  aspectRatio: number = TI_LE,
  outputWidth = OUTPUT_3X4_WIDTH_PX
): Promise<{
  dataUrl: string;
  faceDetected: boolean;
  faceCount: number;
  methodUsed: AutoCropMethod;
  needsReview: boolean;
}> {
  const img = await loadImageFromFile(file);
  const { faces, recommendedConfig } = await detectFacesInImage(img);
  const finalConfig: CropTransformConfig = {
    ...recommendedConfig,
    aspectRatio,
  };
  const dataUrl = renderCroppedIdPhotoToDataUrl(img, finalConfig, outputWidth);
  return {
    dataUrl,
    faceDetected: faces.length > 0,
    faceCount: faces.length,
    methodUsed: recommendedConfig.methodUsed || 'C',
    needsReview: Boolean(recommendedConfig.needsReview),
  };
}

/**
 * Matches an uploaded image filename (e.g. "90993.jpg", "00441.png", "90993 - Nguyen Van A.jpg")
 * to an employee by MSNV first (exact -> leading-zero normalized -> token boundary) or Full Name.
 */
export function matchEmployeeByPhotoFileName<
  T extends { msnv: string; fullName: string }
>(fileName: string, employees: T[]): T | undefined {
  const base = fileName
    .replace(/\.[^/.]+$/, '')
    .trim()
    .toLowerCase();
  if (!base) return undefined;

  // 1. Exact MSNV match (highest priority)
  const exactMsnv = employees.find(
    (emp) => emp.msnv.trim().toLowerCase() === base
  );
  if (exactMsnv) return exactMsnv;

  // 2. Leading-zero normalized numeric MSNV match (e.g. "00441.jpg" <-> "441")
  const baseNoZeros = base.replace(/^0+/, '');
  if (baseNoZeros && /^\d+$/.test(baseNoZeros)) {
    const numMatch = employees.find((emp) => {
      const empClean = emp.msnv.trim().toLowerCase().replace(/^0+/, '');
      return empClean === baseNoZeros;
    });
    if (numMatch) return numMatch;
  }

  // 3. Token boundary MSNV match (e.g. "90993_TruongMinhHieu.jpg", "MSNV-90993.png")
  const tokens = base.split(/[\s_\-.,()[\]]+/).filter(Boolean);
  if (tokens.length > 0) {
    const tokenMatch = employees.find((emp) => {
      const msnv = emp.msnv.trim().toLowerCase();
      if (!msnv) return false;
      const msnvNoZeros = msnv.replace(/^0+/, '');
      return (
        tokens.includes(msnv) ||
        (Boolean(msnvNoZeros) &&
          /^\d+$/.test(msnvNoZeros) &&
          tokens.some((t) => t.replace(/^0+/, '') === msnvNoZeros))
      );
    });
    if (tokenMatch) return tokenMatch;
  }

  // 4. Exact Full Name match
  return employees.find((emp) => emp.fullName.trim().toLowerCase() === base);
}
