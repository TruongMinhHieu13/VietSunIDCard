import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

export type AutoCropMethod = 'A' | 'B' | 'C';

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
  /** Mild sharpening toggle (default true as requested: "tăng nét nhẹ") */
  sharpen: boolean;
  /** Aspect ratio width / height: default 3/4 (0.75) for 354x472 px @ 300 DPI */
  aspectRatio: number;
  /** Which pipeline stage produced this crop ('A' | 'B' | 'C') */
  methodUsed?: AutoCropMethod;
  /** Human-readable description of the stage that succeeded */
  methodDescription?: string;
  /** True when Method C was used and user should review ("XEM") */
  needsReview?: boolean;
}

/** Standard 3x4 cm @ 300 DPI dimensions in pixels */
export const OUTPUT_3X4_WIDTH_PX = 354;
export const OUTPUT_3X4_HEIGHT_PX = 472;

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
          return null;
        }
      }
    })();
  }
  return mediaPipeDetectorPromise;
}

/**
 * Checks whether an RGB pixel is human skin tone (while rejecting red ink stamps on documents).
 */
function isHumanSkinPixel(r: number, g: number, b: number): boolean {
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  // Reject red stamp ink (where red dominates green by > 70 and green is low)
  if (r > 145 && r - g > 70 && g < 95) return false;

  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

  return (
    r > 80 &&
    g > 42 &&
    b > 22 &&
    r > g &&
    r > b &&
    maxC - minC > 12 &&
    cr >= 131 &&
    cr <= 175 &&
    cb >= 77 &&
    cb <= 131
  );
}

/**
 * Helper: Run MediaPipe on a sub-rectangle `(roiX, roiY, roiW, roiH)` of `img`
 * and map face coordinates back to original image pixels.
 */
function runMediaPipeOnRoi(
  mpDetector: FaceDetector,
  img: HTMLImageElement,
  roiX: number,
  roiY: number,
  roiW: number,
  roiH: number
): DetectedFaceBox[] {
  const maxDim = 640;
  const scaleDown =
    Math.max(roiW, roiH) > maxDim ? maxDim / Math.max(roiW, roiH) : 1;
  const cw = Math.max(1, Math.round(roiW * scaleDown));
  const ch = Math.max(1, Math.round(roiH * scaleDown));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  ctx.drawImage(img, roiX, roiY, roiW, roiH, 0, 0, cw, ch);
  const res = mpDetector.detect(canvas);
  if (!res || !res.detections || !res.detections.length) return [];

  const invScale = 1 / scaleDown;
  return res.detections
    .map((det, idx): DetectedFaceBox | null => {
      const bb = det.boundingBox;
      if (!bb) return null;
      const x = roiX + bb.originX * invScale;
      const y = roiY + bb.originY * invScale;
      const width = bb.width * invScale;
      const height = bb.height * invScale;
      const confidence = det.categories?.[0]?.score ?? 0.88;

      const keypoints = (det.keypoints || []).map((kp, kIdx) => ({
        x: roiX + kp.x * roiW,
        y: roiY + kp.y * roiH,
        name:
          kIdx === 0
            ? 'rightEye'
            : kIdx === 1
              ? 'leftEye'
              : kIdx === 2
                ? 'noseTip'
                : kIdx === 3
                  ? 'mouth'
                  : kIdx === 4
                    ? 'rightEar'
                    : 'leftEar',
      }));

      let suggestedTiltDeg = 0;
      if (keypoints.length >= 2) {
        const dx = keypoints[1].x - keypoints[0].x;
        const dy = keypoints[1].y - keypoints[0].y;
        if (Math.abs(dx) > 3) {
          const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
          if (Math.abs(angleDeg) <= 30) {
            suggestedTiltDeg = Number((-angleDeg).toFixed(1));
          }
        }
      }

      return {
        id: idx,
        x,
        y,
        width,
        height,
        confidence,
        keypoints,
        suggestedTiltDeg,
      };
    })
    .filter((f): f is DetectedFaceBox => f !== null);
}

/**
 * Fast skin + hair + ID-backdrop portrait candidate locator on a downsampled canvas.
 * Finds where a human face is located even when the 3x4 photo is tiny on a large table
 * or glued on a document with text and red stamps.
 */
function findSkinHairFaceCandidates(
  img: HTMLImageElement
): Array<{ x: number; y: number; width: number; height: number; score: number }> {
  const imgW = img.naturalWidth || img.width;
  const imgH = img.naturalHeight || img.height;
  const sampleW = 320;
  const sampleH = Math.max(1, Math.round((imgH / imgW) * sampleW));

  const canvas = document.createElement('canvas');
  canvas.width = sampleW;
  canvas.height = sampleH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  ctx.drawImage(img, 0, 0, sampleW, sampleH);
  const { data } = ctx.getImageData(0, 0, sampleW, sampleH);

  const skinMap = new Uint8Array(sampleW * sampleH);
  const hairMap = new Uint8Array(sampleW * sampleH);
  const blueBgMap = new Uint8Array(sampleW * sampleH);

  for (let y = 0; y < sampleH; y++) {
    for (let x = 0; x < sampleW; x++) {
      const idx = (y * sampleW + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      // Dark / medium-dark hair pixel (tolerant to camera glare on glossy 3x4 prints)
      if (lum < 112) {
        hairMap[y * sampleW + x] = 1;
      }

      // Blue/cyan ID card backdrop pixel
      if (b > 95 && b - r > 18 && b >= g - 12) {
        blueBgMap[y * sampleW + x] = 1;
      }

      if (isHumanSkinPixel(r, g, b)) {
        skinMap[y * sampleW + x] = 1;
      }
    }
  }

  const visited = new Uint8Array(sampleW * sampleH);
  const candidates: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    score: number;
  }> = [];

  const scaleX = imgW / sampleW;
  const scaleY = imgH / sampleH;

  for (let y = 3; y < sampleH - 3; y++) {
    for (let x = 3; x < sampleW - 3; x++) {
      const startIdx = y * sampleW + x;
      if (!skinMap[startIdx] || visited[startIdx]) continue;

      const queue = [startIdx];
      visited[startIdx] = 1;
      let minX = x,
        maxX = x,
        minY = y,
        maxY = y;
      let count = 0;

      while (queue.length > 0) {
        const curr = queue.pop()!;
        const cy = Math.floor(curr / sampleW);
        const cx = curr % sampleW;
        count++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx >= 0 && nx < sampleW && ny >= 0 && ny < sampleH) {
              const nIdx = ny * sampleW + nx;
              if (skinMap[nIdx] && !visited[nIdx]) {
                visited[nIdx] = 1;
                queue.push(nIdx);
              }
            }
          }
        }
      }

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (count < 16 || bw < 5 || bh < 6 || bw > sampleW * 0.78) continue;

      // If neck skin is connected to face skin, the face is the upper oval of height ~1.22 * bw
      const faceW = bw;
      const faceH = Math.min(bh, Math.max(6, Math.round(bw * 1.22)));
      const aspect = faceW / Math.max(1, faceH);
      if (aspect < 0.42 || aspect > 1.55) continue;

      // Count dark hair pixels and blue ID backdrop pixels around the head
      let hairCount = 0;
      let blueCount = 0;
      const sTopY = Math.max(0, minY - Math.ceil(faceH * 0.65));
      const sBotY = Math.min(sampleH - 1, minY + Math.ceil(faceH * 0.75));
      const sLeftX = Math.max(0, minX - Math.ceil(faceW * 0.65));
      const sRightX = Math.min(sampleW - 1, maxX + Math.ceil(faceW * 0.65));

      for (let sy = sTopY; sy <= sBotY; sy++) {
        for (let sx = sLeftX; sx <= sRightX; sx++) {
          if (hairMap[sy * sampleW + sx]) hairCount++;
          if (blueBgMap[sy * sampleW + sx]) blueCount++;
        }
      }

      const area = Math.max(1, faceW * faceH);
      const hairRatio = hairCount / area;
      const blueRatio = blueCount / area;

      if (hairRatio < 0.03 && blueRatio < 0.05) continue;

      const fillRatio = Math.min(1, count / area);
      const centerBonus =
        1 -
        0.3 *
          Math.hypot(
            (minX + faceW / 2) / sampleW - 0.5,
            (minY + faceH / 2) / sampleH - 0.5
          );
      const backdropBonus = 1 + Math.min(1.5, blueRatio * 2.5);
      const hairBonus = 0.6 + Math.min(1.5, hairRatio * 2.0);
      const score =
        count * fillRatio * hairBonus * backdropBonus * centerBonus;

      candidates.push({
        x: minX * scaleX,
        y: minY * scaleY,
        width: faceW * scaleX,
        height: faceH * scaleY,
        score,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/**
 * STAGE A (Cách chính):
 * "A. Tìm khuôn mặt -> lần theo phông nền quanh đầu để lấy mép trên và hai mép bên của
 *  ảnh thẻ -> nắn thẳng -> cắt 3:4 tính từ mép trên."
 *
 * Works for BOTH a 3x4 photo lying on a table AND a 3x4 photo glued on an HR document
 * (even when surrounded by text or stamped with a red seal on the lower corner).
 */
function tryMethodA_TraceBackdropAroundHead(
  img: HTMLImageElement,
  face: DetectedFaceBox
): {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  angleDeg: number;
} | null {
  const imgW = img.naturalWidth || img.width;
  const imgH = img.naturalHeight || img.height;

  // Extract a high-res working patch around the face
  const roiPadX = face.width * 2.2;
  const roiPadTop = face.height * 1.5;
  const roiPadBot = face.height * 2.8;

  const roiX = Math.max(0, Math.floor(face.x - roiPadX));
  const roiY = Math.max(0, Math.floor(face.y - roiPadTop));
  const roiW = Math.min(imgW - roiX, Math.ceil(face.width + roiPadX * 2));
  const roiH = Math.min(
    imgH - roiY,
    Math.ceil(face.height + roiPadTop + roiPadBot)
  );

  if (roiW < 24 || roiH < 32) return null;

  const workScale = Math.min(1, 440 / Math.max(roiW, roiH));
  const wW = Math.max(40, Math.round(roiW * workScale));
  const wH = Math.max(50, Math.round(roiH * workScale));

  const canvas = document.createElement('canvas');
  canvas.width = wW;
  canvas.height = wH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(img, roiX, roiY, roiW, roiH, 0, 0, wW, wH);
  const { data } = ctx.getImageData(0, 0, wW, wH);

  // Face coordinates in working canvas
  const fx = (face.x - roiX) * workScale;
  const fy = (face.y - roiY) * workScale;
  const fw = face.width * workScale;
  const fh = face.height * workScale;
  const fcx = fx + fw / 2;

  const getRgb = (x: number, y: number): [number, number, number] => {
    const ix = Math.max(0, Math.min(wW - 1, Math.round(x)));
    const iy = Math.max(0, Math.min(wH - 1, Math.round(y)));
    const idx = (iy * wW + ix) * 4;
    return [data[idx], data[idx + 1], data[idx + 2]];
  };

  const colorDist = (
    c1: [number, number, number],
    c2: [number, number, number]
  ): number => {
    return Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2]);
  };

  // Step 1: March outward from the left & right edges of the face, stepping PAST any skin and PAST any dark hair,
  // to land squarely inside the uniform ID-photo backdrop ("phông nền quanh đầu")!
  const backdropSamples: Array<[number, number, number]> = [];
  const leftSeeds: Array<{ x: number; y: number; rgb: [number, number, number] }> = [];
  const rightSeeds: Array<{ x: number; y: number; rgb: [number, number, number] }> = [];

  const scanYStart = Math.max(4, Math.round(fy - fh * 0.25));
  const scanYEnd = Math.min(wH - 4, Math.round(fy + fh * 0.55));
  const scanStepY = Math.max(1, Math.round(fh * 0.06));

  for (let y = scanYStart; y <= scanYEnd; y += scanStepY) {
    // Search Left: start from left temple `fx - 0.04*fw` and step left past hair until we hit smooth non-skin, non-dark-hair backdrop
    const startLeftX = Math.max(4, Math.round(fx - fw * 0.04));
    const minSearchLeft = Math.max(3, Math.round(fcx - fw * 1.15));
    for (let x = startLeftX; x >= minSearchLeft; x--) {
      const c = getRgb(x, y);
      const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      // Skip dark hair (`lum < 95`) and skip skin (`isHumanSkinPixel`)
      if (lum < 95 || isHumanSkinPixel(c[0], c[1], c[2])) continue;

      const cLeft = getRgb(x - 2, y);
      const cUp = getRgb(x, y - 2);
      if (colorDist(c, cLeft) < 18 && colorDist(c, cUp) < 18) {
        backdropSamples.push(c);
        leftSeeds.push({ x, y, rgb: c });
        break;
      }
    }

    // Search Right: start from right temple `fx + 1.04*fw` and step right past hair until we hit smooth backdrop
    const startRightX = Math.min(wW - 5, Math.round(fx + fw * 1.04));
    const maxSearchRight = Math.min(wW - 4, Math.round(fcx + fw * 1.15));
    for (let x = startRightX; x <= maxSearchRight; x++) {
      const c = getRgb(x, y);
      const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      if (lum < 95 || isHumanSkinPixel(c[0], c[1], c[2])) continue;

      const cRight = getRgb(x + 2, y);
      const cUp = getRgb(x, y - 2);
      if (colorDist(c, cRight) < 18 && colorDist(c, cUp) < 18) {
        backdropSamples.push(c);
        rightSeeds.push({ x, y, rgb: c });
        break;
      }
    }
  }

  if (
    backdropSamples.length < 4 ||
    leftSeeds.length < 2 ||
    rightSeeds.length < 2
  ) {
    return null;
  }

  // Compute median backdrop color (bgR, bgG, bgB)
  const sortedR = backdropSamples.map((s) => s[0]).sort((a, b) => a - b);
  const sortedG = backdropSamples.map((s) => s[1]).sort((a, b) => a - b);
  const sortedB = backdropSamples.map((s) => s[2]).sort((a, b) => a - b);
  const mid = Math.floor(backdropSamples.length / 2);
  const bgMedian: [number, number, number] = [
    sortedR[mid],
    sortedG[mid],
    sortedB[mid],
  ];

  // Step 2: Trace outward from each Left Seed and Right Seed to find the Left Edge & Right Edge ("hai mép bên")
  const leftEdgePts: Array<{ x: number; y: number }> = [];
  const rightEdgePts: Array<{ x: number; y: number }> = [];

  const maxCardHalfW = fw * 1.9;
  const bgTolerance = 36;
  const stepEdgeTolerance = 20;

  for (const seed of leftSeeds) {
    if (colorDist(seed.rgb, bgMedian) > 35) continue;
    let prevRgb = seed.rgb;
    const minX = Math.max(2, Math.round(fcx - maxCardHalfW));
    for (let x = seed.x - 1; x >= minX; x--) {
      const curRgb = getRgb(x, seed.y);
      const nextRgb = getRgb(x - 1, seed.y);
      const distFromBg = colorDist(curRgb, bgMedian);
      const distFromSeed = colorDist(curRgb, seed.rgb);
      const localStep = colorDist(nextRgb, prevRgb);

      if (
        (distFromBg > bgTolerance && distFromSeed > bgTolerance) ||
        (localStep > stepEdgeTolerance && colorDist(nextRgb, bgMedian) > 22)
      ) {
        leftEdgePts.push({ x: x + 1, y: seed.y });
        break;
      }
      prevRgb = curRgb;
    }
  }

  for (const seed of rightSeeds) {
    if (colorDist(seed.rgb, bgMedian) > 35) continue;
    let prevRgb = seed.rgb;
    const maxX = Math.min(wW - 3, Math.round(fcx + maxCardHalfW));
    for (let x = seed.x + 1; x <= maxX; x++) {
      const curRgb = getRgb(x, seed.y);
      const nextRgb = getRgb(x + 1, seed.y);
      const distFromBg = colorDist(curRgb, bgMedian);
      const distFromSeed = colorDist(curRgb, seed.rgb);
      const localStep = colorDist(nextRgb, prevRgb);

      if (
        (distFromBg > bgTolerance && distFromSeed > bgTolerance) ||
        (localStep > stepEdgeTolerance && colorDist(nextRgb, bgMedian) > 22)
      ) {
        rightEdgePts.push({ x: x - 1, y: seed.y });
        break;
      }
      prevRgb = curRgb;
    }
  }

  if (leftEdgePts.length < 2 || rightEdgePts.length < 2) {
    return null;
  }

  const medianVal = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  const medLeftX = medianVal(leftEdgePts.map((p) => p.x));
  const medRightX = medianVal(rightEdgePts.map((p) => p.x));
  const cardW = medRightX - medLeftX;

  // Sanity check: In a 3x4 ID photo, card width is between 1.3x and 3.4x the face width
  if (cardW < fw * 1.3 || cardW > fw * 3.4) {
    return null;
  }
  const cardCenterX = (medLeftX + medRightX) / 2;
  if (Math.abs(cardCenterX - fcx) > cardW * 0.25) {
    return null;
  }

  // Step 3: Trace UPWARD from the Left & Right backdrop strips and above the head to find the Top Edge ("mép trên")
  const topEdgePts: Array<{ x: number; y: number }> = [];
  const minTopY = Math.max(2, Math.round(fy - fh * 1.3));
  const startTopY = Math.round(fy + fh * 0.2);

  for (
    let x = Math.round(medLeftX + cardW * 0.06);
    x <= Math.round(medRightX - cardW * 0.06);
    x += Math.max(2, Math.round(cardW * 0.05))
  ) {
    let seedY = -1;
    let seedRgb: [number, number, number] = bgMedian;
    for (let y = startTopY; y >= Math.round(fy - fh * 0.55); y -= 2) {
      const c = getRgb(x, y);
      if (colorDist(c, bgMedian) < 30) {
        seedY = y;
        seedRgb = c;
        break;
      }
    }
    if (seedY < 0) continue;

    let prevRgb = seedRgb;
    for (let y = seedY - 1; y >= minTopY; y--) {
      const curRgb = getRgb(x, y);
      const nextRgb = getRgb(x, y - 1);
      const distFromBg = colorDist(curRgb, bgMedian);
      const distFromSeed = colorDist(curRgb, seedRgb);
      const localStep = colorDist(nextRgb, prevRgb);

      if (
        (distFromBg > bgTolerance && distFromSeed > bgTolerance) ||
        (localStep > stepEdgeTolerance && colorDist(nextRgb, bgMedian) > 22)
      ) {
        topEdgePts.push({ x, y: y + 1 });
        break;
      }
      prevRgb = curRgb;
    }
  }

  if (topEdgePts.length < 2) {
    return null;
  }

  const medTopY = medianVal(topEdgePts.map((p) => p.y));
  if (medTopY > fy + fh * 0.12 || fy - medTopY > fh * 1.2) {
    return null;
  }

  // Step 4: Fit lines to Top Edge and Left/Right Edges -> Straighten ("nắn thẳng")
  const fitLineAngleDeg = (
    pts: Array<{ x: number; y: number }>,
    isVerticalEdge: boolean
  ): number | null => {
    if (pts.length < 3) return null;
    const medCoord = isVerticalEdge
      ? medianVal(pts.map((q) => q.x))
      : medianVal(pts.map((q) => q.y));
    const filtered = isVerticalEdge
      ? pts.filter((p) => Math.abs(p.x - medCoord) < cardW * 0.08)
      : pts.filter((p) => Math.abs(p.y - medCoord) < cardW * 0.08);
    if (filtered.length < 3) return null;

    let sumA = 0,
      sumB = 0,
      sumAB = 0,
      sumA2 = 0;
    const n = filtered.length;
    for (const p of filtered) {
      const a = isVerticalEdge ? p.y : p.x;
      const b = isVerticalEdge ? p.x : p.y;
      sumA += a;
      sumB += b;
      sumAB += a * b;
      sumA2 += a * a;
    }
    const denom = n * sumA2 - sumA * sumA;
    if (Math.abs(denom) < 1e-5) return 0;
    const slope = (n * sumAB - sumA * sumB) / denom;
    const angle = isVerticalEdge
      ? (-Math.atan(slope) * 180) / Math.PI
      : (Math.atan(slope) * 180) / Math.PI;
    return Math.abs(angle) <= 25 ? angle : null;
  };

  const angles: number[] = [];
  const topAngle = fitLineAngleDeg(topEdgePts, false);
  const leftAngle = fitLineAngleDeg(leftEdgePts, true);
  const rightAngle = fitLineAngleDeg(rightEdgePts, true);
  if (topAngle !== null) angles.push(topAngle);
  if (leftAngle !== null) angles.push(leftAngle);
  if (rightAngle !== null) angles.push(rightAngle);

  const cardTiltDeg =
    angles.length > 0
      ? Number(
          (angles.reduce((acc, v) => acc + v, 0) / angles.length).toFixed(1)
        )
      : 0;

  // Step 5: "cắt 3:4 tính từ mép trên"
  const inset = cardW * 0.018;
  const cleanW = cardW - inset * 2;
  const cleanH = (cleanW * 4) / 3;
  const cleanTopY = medTopY + inset;
  const cleanCenterY = cleanTopY + cleanH / 2;

  const invWorkScale = 1 / workScale;
  return {
    centerX: roiX + cardCenterX * invWorkScale,
    centerY: roiY + cleanCenterY * invWorkScale,
    width: cleanW * invWorkScale,
    height: cleanH * invWorkScale,
    angleDeg: -cardTiltDeg,
  };
}

/**
 * STAGE B (Dự phòng cho ảnh nghiêng nhiều trên mặt bàn):
 * "B. Tìm tấm ảnh như một khối khác màu mặt bàn -> nắn thẳng. (ảnh nghiêng nhiều)"
 */
export function tryMethodB_TableColorBlockDeskew(
  img: HTMLImageElement
): {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  angleDeg: number;
} | null {
  const imgW = img.naturalWidth || img.width;
  const imgH = img.naturalHeight || img.height;
  if (!imgW || !imgH) return null;

  const sampleW = 240;
  const sampleH = Math.max(1, Math.round((imgH / imgW) * sampleW));
  const canvas = document.createElement('canvas');
  canvas.width = sampleW;
  canvas.height = sampleH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0, sampleW, sampleH);
  const { data } = ctx.getImageData(0, 0, sampleW, sampleH);

  const borderX = Math.max(4, Math.floor(sampleW * 0.09));
  const borderY = Math.max(4, Math.floor(sampleH * 0.09));

  let sumR = 0,
    sumG = 0,
    sumB = 0,
    bCount = 0;
  for (let y = 0; y < sampleH; y += 2) {
    for (let x = 0; x < sampleW; x += 2) {
      if (
        x < borderX ||
        x >= sampleW - borderX ||
        y < borderY ||
        y >= sampleH - borderY
      ) {
        const idx = (y * sampleW + x) * 4;
        sumR += data[idx];
        sumG += data[idx + 1];
        sumB += data[idx + 2];
        bCount++;
      }
    }
  }
  if (bCount === 0) return null;
  const bgR = sumR / bCount;
  const bgG = sumG / bCount;
  const bgB = sumB / bCount;

  const rowBgR = new Float32Array(sampleH);
  const rowBgG = new Float32Array(sampleH);
  const rowBgB = new Float32Array(sampleH);
  for (let y = 0; y < sampleH; y++) {
    let r = 0,
      g = 0,
      b = 0,
      c = 0;
    for (let x = 2; x < borderX; x += 2) {
      const i1 = (y * sampleW + x) * 4;
      const i2 = (y * sampleW + (sampleW - 1 - x)) * 4;
      r += data[i1] + data[i2];
      g += data[i1 + 1] + data[i2 + 1];
      b += data[i1 + 2] + data[i2 + 2];
      c += 2;
    }
    rowBgR[y] = c > 0 ? r / c : bgR;
    rowBgG[y] = c > 0 ? g / c : bgG;
    rowBgB[y] = c > 0 ? b / c : bgB;
  }

  const fg = new Uint8Array(sampleW * sampleH);
  const marginX = Math.floor(sampleW * 0.05);
  const marginY = Math.floor(sampleH * 0.05);

  for (let y = marginY; y < sampleH - marginY; y++) {
    const lr = rowBgR[y],
      lg = rowBgG[y],
      lb = rowBgB[y];
    const lSat = Math.max(lr, lg, lb) - Math.min(lr, lg, lb);

    for (let x = marginX; x < sampleW - marginX; x++) {
      const idx = (y * sampleW + x) * 4;
      const r = data[idx],
        g = data[idx + 1],
        b = data[idx + 2];
      const dist = Math.hypot(r - lr, g - lg, b - lb);
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      const satDiff = Math.max(0, sat - lSat);
      if (dist + satDiff * 1.1 > 38) {
        fg[y * sampleW + x] = 1;
      }
    }
  }

  const visited = new Uint8Array(sampleW * sampleH);
  let bestBlob: Array<{ x: number; y: number }> = [];
  let bestScore = 0;

  for (let y = marginY; y < sampleH - marginY; y++) {
    for (let x = marginX; x < sampleW - marginX; x++) {
      const start = y * sampleW + x;
      if (!fg[start] || visited[start]) continue;

      const queue = [start];
      visited[start] = 1;
      const pts: Array<{ x: number; y: number }> = [];
      let sumX = 0,
        sumY = 0;

      while (queue.length > 0) {
        const curr = queue.pop()!;
        const cy = Math.floor(curr / sampleW);
        const cx = curr % sampleW;
        pts.push({ x: cx, y: cy });
        sumX += cx;
        sumY += cy;

        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (
              nx >= marginX &&
              nx < sampleW - marginX &&
              ny >= marginY &&
              ny < sampleH - marginY
            ) {
              const nIdx = ny * sampleW + nx;
              if (fg[nIdx] && !visited[nIdx]) {
                visited[nIdx] = 1;
                queue.push(nIdx);
              }
            }
          }
        }
      }

      if (
        pts.length < sampleW * sampleH * 0.006 ||
        pts.length > sampleW * sampleH * 0.75
      ) {
        continue;
      }

      const cx = sumX / pts.length;
      const cy = sumY / pts.length;
      const centerWeight =
        1 - 0.4 * Math.hypot(cx / sampleW - 0.5, cy / sampleH - 0.5);
      const score = pts.length * centerWeight;
      if (score > bestScore) {
        bestScore = score;
        bestBlob = pts;
      }
    }
  }

  if (bestBlob.length < 30) return null;

  let bestAngleDeg = 0;
  let minArea = Infinity;
  let bestBounds = { minU: 0, maxU: 0, minV: 0, maxV: 0 };

  const step = Math.max(1, Math.floor(bestBlob.length / 400));
  const subPts = bestBlob.filter((_, idx) => idx % step === 0);

  for (let deg = -42; deg <= 42; deg += 1) {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    let minU = Infinity,
      maxU = -Infinity,
      minV = Infinity,
      maxV = -Infinity;

    for (const p of subPts) {
      const u = p.x * cos + p.y * sin;
      const v = -p.x * sin + p.y * cos;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    const w = maxU - minU;
    const h = maxV - minV;
    const area = w * h;
    if (area < minArea) {
      minArea = area;
      bestAngleDeg = deg;
      bestBounds = { minU, maxU, minV, maxV };
    }
  }

  const rad = (bestAngleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const uCenter = (bestBounds.minU + bestBounds.maxU) / 2;
  const vCenter = (bestBounds.minV + bestBounds.maxV) / 2;
  const cxSample = uCenter * cos - vCenter * sin;
  const cySample = uCenter * sin + vCenter * cos;

  let boxW = bestBounds.maxU - bestBounds.minU;
  let boxH = bestBounds.maxV - bestBounds.minV;

  if (boxW > boxH * 1.1) {
    const tmp = boxW;
    boxW = boxH;
    boxH = tmp;
    bestAngleDeg = bestAngleDeg > 0 ? bestAngleDeg - 90 : bestAngleDeg + 90;
  }

  const aspect = boxW / Math.max(1, boxH);
  if (aspect < 0.42 || aspect > 1.08) return null;

  const scaleX = imgW / sampleW;
  const scaleY = imgH / sampleH;

  const realW = boxW * scaleX * 0.95;
  const realH = (realW * 4) / 3;
  const topOffset = (boxH * scaleY * 0.95 - realH) / 2;

  return {
    centerX: cxSample * scaleX,
    centerY: cySample * scaleY - Math.max(0, topOffset),
    width: realW,
    height: realH,
    angleDeg: -bestAngleDeg,
  };
}

/**
 * Master AI Detection & 3-Stage Pipeline (A -> B -> C):
 * 1. Finds all faces in the image using a Multi-Scale Pyramid (Skin/Hair/Backdrop locator + MediaPipe BlazeFace).
 * 2. Executes the user's exact 3-stage pipeline (stopping at the first method that succeeds):
 *    - Method A: Face -> trace backdrop around head -> top & side edges -> straighten -> crop 3:4 from top edge.
 *    - Method B: Find photo card as a distinct color block on table -> straighten -> crop 3:4.
 *    - Method C: Crop 3:4 around face without rotation -> mark "XEM".
 */
export async function detectFacesInImage(
  img: HTMLImageElement
): Promise<{
  faces: DetectedFaceBox[];
  engineUsed: 'method_a' | 'method_b' | 'method_c';
  detectedCardRect: {
    x: number;
    y: number;
    width: number;
    height: number;
    angleDeg?: number;
    method?: AutoCropMethod;
  } | null;
  recommendedConfig: CropTransformConfig;
}> {
  const imgW = img.naturalWidth || img.width;
  const imgH = img.naturalHeight || img.height;

  const skinHairCandidates = findSkinHairFaceCandidates(img);
  const methodBBlock = tryMethodB_TableColorBlockDeskew(img);
  const mpDetector = await getMediaPipeFaceDetector();

  let detectedFaces: DetectedFaceBox[] = [];

  if (mpDetector) {
    try {
      // 1a. Probe tight windows around skin+hair+backdrop candidates first!
      for (const cand of skinHairCandidates.slice(0, 3)) {
        const padW = cand.width * 2.0;
        const padH = cand.height * 2.2;
        const rx = Math.max(0, cand.x - padW);
        const ry = Math.max(0, cand.y - padH);
        const rw = Math.min(imgW - rx, cand.width + padW * 2);
        const rh = Math.min(imgH - ry, cand.height + padH * 2);
        const found = runMediaPipeOnRoi(mpDetector, img, rx, ry, rw, rh);
        if (found.length > 0) {
          detectedFaces.push(...found);
          break;
        }
      }

      // 1b. Probe inside Method B table block if found
      if (detectedFaces.length === 0 && methodBBlock) {
        const rx = Math.max(0, methodBBlock.centerX - methodBBlock.width * 0.8);
        const ry = Math.max(0, methodBBlock.centerY - methodBBlock.height * 0.8);
        const rw = Math.min(imgW - rx, methodBBlock.width * 1.6);
        const rh = Math.min(imgH - ry, methodBBlock.height * 1.6);
        const found = runMediaPipeOnRoi(mpDetector, img, rx, ry, rw, rh);
        if (found.length > 0) {
          detectedFaces.push(...found);
        }
      }

      // 1c. Probe full image
      if (detectedFaces.length === 0) {
        const fullFound = runMediaPipeOnRoi(mpDetector, img, 0, 0, imgW, imgH);
        if (fullFound.length > 0) {
          detectedFaces.push(...fullFound);
        }
      }

      // 1d. Probe concentric center windows (40% and 22%)
      if (detectedFaces.length === 0) {
        for (const frac of [0.42, 0.22]) {
          const rw = imgW * frac;
          const rh = imgH * frac;
          const rx = (imgW - rw) / 2;
          const ry = (imgH - rh) / 2;
          const found = runMediaPipeOnRoi(mpDetector, img, rx, ry, rw, rh);
          if (found.length > 0) {
            detectedFaces.push(...found);
            break;
          }
        }
      }
    } catch (err) {
      console.warn('MediaPipe detection pass error:', err);
    }
  }

  // Fallback to skin+hair face candidates if MediaPipe didn't fire
  if (detectedFaces.length === 0 && skinHairCandidates.length > 0) {
    detectedFaces = skinHairCandidates.slice(0, 3).map((c, idx) => ({
      id: idx,
      x: c.x,
      y: c.y,
      width: c.width,
      height: c.height,
      confidence: 0.9,
      keypoints: [],
      suggestedTiltDeg: 0,
    }));
  }

  detectedFaces.sort(
    (a, b) =>
      b.width * b.height * b.confidence - a.width * a.height * a.confidence
  );
  detectedFaces = detectedFaces.map((f, idx) => ({ ...f, id: idx }));

  const primaryFace = detectedFaces[0] || null;

  // --- STAGE A (Cách chính):
  // Tìm khuôn mặt -> lần theo phông nền quanh đầu để lấy mép trên và hai mép bên -> nắn thẳng -> cắt 3:4 tính từ mép trên
  if (primaryFace) {
    const resA = tryMethodA_TraceBackdropAroundHead(img, primaryFace);
    if (resA) {
      const cardRect = {
        x: resA.centerX - resA.width / 2,
        y: resA.centerY - resA.height / 2,
        width: resA.width,
        height: resA.height,
        angleDeg: resA.angleDeg,
        method: 'A' as AutoCropMethod,
      };
      primaryFace.photoCardRect = cardRect;

      return {
        faces: detectedFaces,
        engineUsed: 'method_a',
        detectedCardRect: cardRect,
        recommendedConfig: {
          centerX: resA.centerX,
          centerY: resA.centerY,
          scale: 1,
          baseCropHeight: resA.height,
          rotationDeg: resA.angleDeg,
          flipH: false,
          brightness: 100,
          contrast: 100,
          sharpen: true,
          aspectRatio: 3 / 4,
          methodUsed: 'A',
          methodDescription:
            'Cách A (Chính): Tìm mặt → Lần phông nền quanh đầu lấy mép trên & 2 mép bên → Nắn thẳng → Cắt 3:4 từ mép trên',
          needsReview: false,
        },
      };
    }
  }

  // --- STAGE B (Ảnh nghiêng nhiều trên mặt bàn):
  // Tìm tấm ảnh như một khối khác màu mặt bàn -> nắn thẳng
  if (methodBBlock) {
    const cardRect = {
      x: methodBBlock.centerX - methodBBlock.width / 2,
      y: methodBBlock.centerY - methodBBlock.height / 2,
      width: methodBBlock.width,
      height: methodBBlock.height,
      angleDeg: methodBBlock.angleDeg,
      method: 'B' as AutoCropMethod,
    };
    if (primaryFace) {
      primaryFace.photoCardRect = cardRect;
    }

    return {
      faces: detectedFaces,
      engineUsed: 'method_b',
      detectedCardRect: cardRect,
      recommendedConfig: {
        centerX: methodBBlock.centerX,
        centerY: methodBBlock.centerY,
        scale: 1,
        baseCropHeight: methodBBlock.height,
        rotationDeg: methodBBlock.angleDeg,
        flipH: false,
        brightness: 100,
        contrast: 100,
        sharpen: true,
        aspectRatio: 3 / 4,
        methodUsed: 'B',
        methodDescription:
          'Cách B: Tìm tấm ảnh như một khối khác màu mặt bàn → Nắn thẳng → Cắt 3:4',
        needsReview: false,
      },
    };
  }

  // --- STAGE C (Cắt khung 3:4 quanh khuôn mặt, không nắn -> đánh dấu "XEM"):
  const fallbackConfig = computeIdCropConfigFromFace(
    imgW,
    imgH,
    primaryFace,
    3 / 4,
    false
  );
  return {
    faces: detectedFaces,
    engineUsed: 'method_c',
    detectedCardRect: null,
    recommendedConfig: {
      ...fallbackConfig,
      rotationDeg: 0,
      sharpen: true,
      methodUsed: 'C',
      methodDescription:
        'Cách C (XEM): Cắt khung 3:4 quanh khuôn mặt, không nắn thẳng',
      needsReview: true,
    },
  };
}

/**
 * Given a detected face bounding box (or stage result), calculates the 3:4 ID photo crop transform.
 */
export function computeIdCropConfigFromFace(
  imgWidth: number,
  imgHeight: number,
  face: DetectedFaceBox | null,
  aspectRatio: number = 3 / 4,
  preferCardBoundary = true
): CropTransformConfig {
  if (face?.photoCardRect && preferCardBoundary) {
    const rect = face.photoCardRect;
    const adjustedH =
      Math.abs(aspectRatio - 3 / 4) < 0.01
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
    };
  }

  if (!face) {
    const fitH = Math.min(imgHeight, imgWidth / aspectRatio) * 0.45;
    return {
      centerX: imgWidth / 2,
      centerY: imgHeight * 0.45,
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
    };
  }

  // Stage C framing: 3:4 box around the face, no rotation ("Cắt khung 3:4 quanh khuôn mặt, không nắn")
  const cropW = face.width * 1.92;
  const cropH = cropW / aspectRatio;
  const topY = face.y - face.height * 0.38;
  const centerY = topY + cropH / 2;

  let faceCenterX = face.x + face.width / 2;
  if (face.keypoints.length >= 2) {
    const eyeMidX = (face.keypoints[0].x + face.keypoints[1].x) / 2;
    faceCenterX = faceCenterX * 0.4 + eyeMidX * 0.6;
  }

  return {
    centerX: faceCenterX,
    centerY,
    scale: 1,
    baseCropHeight: Math.max(24, cropH),
    rotationDeg: 0,
    flipH: false,
    brightness: 100,
    contrast: 100,
    sharpen: true,
    aspectRatio,
    methodUsed: 'C',
    needsReview: true,
  };
}

/**
 * Applies a mild Unsharp Mask / 3x3 sharpening convolution ("tăng nét nhẹ") on a 2D canvas context.
 */
function applyMildSharpenToCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  amount = 0.22
): void {
  const srcImage = ctx.getImageData(0, 0, width, height);
  const src = srcImage.data;
  const dstImage = ctx.createImageData(width, height);
  const dst = dstImage.data;

  const centerWeight = 1 + 4 * amount;
  const sideWeight = -amount;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        dst[idx] = src[idx];
        dst[idx + 1] = src[idx + 1];
        dst[idx + 2] = src[idx + 2];
        dst[idx + 3] = src[idx + 3];
        continue;
      }

      const idxUp = ((y - 1) * width + x) * 4;
      const idxDown = ((y + 1) * width + x) * 4;
      const idxLeft = (y * width + (x - 1)) * 4;
      const idxRight = (y * width + (x + 1)) * 4;

      for (let c = 0; c < 3; c++) {
        const val =
          src[idx + c] * centerWeight +
          (src[idxUp + c] +
            src[idxDown + c] +
            src[idxLeft + c] +
            src[idxRight + c]) *
            sideWeight;
        dst[idx + c] = Math.max(0, Math.min(255, Math.round(val)));
      }
      dst[idx + 3] = src[idx + 3];
    }
  }

  ctx.putImageData(dstImage, 0, 0);
}

/**
 * Renders the cropped ID photo to exact 3x4 cm @ 300 DPI (354 x 472 px by default)
 * and applies mild sharpening ("phóng về 3x4 cm @ 300 DPI (354 x 472 px) và tăng nét nhẹ").
 */
export function renderCroppedIdPhotoToDataUrl(
  img: HTMLImageElement,
  config: CropTransformConfig,
  outputWidth = OUTPUT_3X4_WIDTH_PX
): string {
  const outputHeight =
    outputWidth === OUTPUT_3X4_WIDTH_PX &&
    Math.abs(config.aspectRatio - 3 / 4) < 0.01
      ? OUTPUT_3X4_HEIGHT_PX
      : Math.round(outputWidth / config.aspectRatio);

  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outputWidth, outputHeight);

  const effectiveCropHeight =
    config.baseCropHeight / Math.max(0.08, config.scale);
  const drawScale = outputHeight / Math.max(1, effectiveCropHeight);

  ctx.save();
  if (config.brightness !== 100 || config.contrast !== 100) {
    ctx.filter = `brightness(${config.brightness}%) contrast(${config.contrast}%)`;
  }

  ctx.translate(outputWidth / 2, outputHeight / 2);

  if (config.flipH) {
    ctx.scale(-1, 1);
  }
  if (config.rotationDeg !== 0) {
    ctx.rotate((config.rotationDeg * Math.PI) / 180);
  }

  ctx.scale(drawScale, drawScale);
  ctx.drawImage(
    img,
    -config.centerX,
    -config.centerY,
    img.naturalWidth,
    img.naturalHeight
  );
  ctx.restore();

  if (config.sharpen !== false) {
    applyMildSharpenToCanvas(ctx, outputWidth, outputHeight, 0.22);
  }

  return canvas.toDataURL('image/jpeg', 0.94);
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
 * Automatic 1-step A -> B -> C pipeline + 354x472 px (3x4 cm @ 300 DPI) + mild sharpening from any File.
 */
export async function autoCropFileWithFaceAI(
  file: File,
  aspectRatio: number = 3 / 4,
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
