"""Tự động cắt ảnh thẻ 3x4 từ ảnh chụp lại tấm ảnh thẻ.

Dùng được cho cả ảnh thẻ đặt trên bàn lẫn ảnh thẻ dán trên hồ sơ (có chữ, dấu đỏ xung quanh).

Cách dùng:
    python anh_the.py                      # xử lý mọi ảnh trong ./input -> ./output
    python anh_the.py duong_dan_anh.jpg    # một ảnh
    python anh_the.py thu_muc_anh -o ra    # cả thư mục, chỉ định thư mục xuất
    python anh_the.py --debug              # lưu thêm ảnh khoanh vùng để kiểm tra

Quy trình cho mỗi ảnh (thử lần lượt, dừng ở cách đầu tiên thành công):
    A. Tìm khuôn mặt -> lần theo phông nền quanh đầu để lấy mép trên và hai mép bên của
       ảnh thẻ -> nắn thẳng -> cắt 3:4 tính từ mép trên. Chỉ tin khi phông có màu (xanh...).
    B. Tìm tờ giấy ảnh theo đường mép của nó trên nền trơn -> nắn thẳng, xoay đúng chiều ->
       xác nhận có khuôn mặt bên trong -> bỏ viền giấy. Dùng cho phông trắng / xám, ảnh
       đặt nghiêng nhiều hoặc nằm ngang.
    C. Cắt khung 3:4 quanh khuôn mặt, không nắn.                   (đánh dấu "XEM")
    A2. Tìm ba đường thẳng dài (mép trái, phải, trên) quanh từng khuôn mặt ứng viên. Dùng
       cho ảnh phông trắng dán trên hồ sơ, nơi xung quanh toàn chữ và dấu.
Nếu có dấu đỏ đóng đè lên ảnh thẻ thì xóa (tắt bằng --giu-dau).
Sau đó phóng về 3x4 cm @ 300 DPI (354 x 472 px) và chỉnh đẹp theo --muc 0..3: cân màu và
làm sáng theo giấy trắng quanh ảnh, khử nhiễu, tăng tương phản, tăng nét (mặc định mức 2).
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

DUOI_ANH = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
TI_LE = 3 / 4  # rộng / cao
DETECT_MAX = 1200  # cạnh dài nhất khi dò tấm ảnh theo nền bàn (px)
# Bố cục ảnh thẻ chuẩn, đo từ ảnh mẫu: khung dò mặt rộng ~52% bề ngang ảnh,
# mép trên của khung dò mặt cách đỉnh ảnh ~17% chiều cao.
MAT_RONG = 0.52
MAT_Y = 0.17
# Khung dò mặt phải chiếm từng này bề ngang ảnh thẻ thì mới coi là hợp lý.
MAT_RONG_MIN, MAT_RONG_MAX = 0.30, 0.78
# Phông nền đậm màu từ mức này (xanh dương, xanh ngọc...) thì dò theo phông là tin được.
PHONG_CO_MAU = 16.0
# Độ dốc sáng-tối tối thiểu để coi một điểm là điểm mép (dò mép ảnh thẻ theo đường thẳng).
MEP_NGUONG = 12.0
# Số khuôn mặt ứng viên đem thử ở mỗi chiều xoay (hồ sơ nhiều chữ, dấu thì hay có mặt dò nhầm).
SO_MAT_THU = 6

Hop = tuple[int, int, int, int]  # x, y, rộng, cao
CAC_CHIEU = (None, cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_90_COUNTERCLOCKWISE, cv2.ROTATE_180)


@dataclass
class KetQua:
    anh: np.ndarray  # ảnh 3x4 đã cắt (BGR)
    nen: np.ndarray  # ảnh gốc (đã xoay đúng chiều) mà `goc` tính theo
    goc: np.ndarray | None  # 4 góc vùng cắt trên `nen` (để vẽ debug)
    ghi_chu: str = ""
    vong_dau: list[tuple[float, float, float]] | None = None  # con dấu đỏ tìm thấy trên `nen`
    da_xoa_dau: bool = False
    go_loi: dict | None = None  # ảnh trung gian của bước xóa dấu (chỉ để soát / gỡ lỗi)


# ---------------------------------------------------------------- đọc / ghi

def doc_anh(duong_dan: Path) -> np.ndarray | None:
    """Đọc ảnh, chịu được đường dẫn có dấu tiếng Việt và xoay theo EXIF."""
    try:
        from PIL import ImageOps

        with Image.open(duong_dan) as im:
            im = ImageOps.exif_transpose(im).convert("RGB")
            return cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2BGR)
    except Exception:
        return None


def luu_anh(anh: np.ndarray, duong_dan: Path, dpi: int, chat_luong: int = 95) -> None:
    im = Image.fromarray(cv2.cvtColor(anh, cv2.COLOR_BGR2RGB))
    duong_dan.parent.mkdir(parents=True, exist_ok=True)
    if duong_dan.suffix.lower() == ".png":
        im.save(duong_dan, dpi=(dpi, dpi))
    else:
        im.save(duong_dan, quality=chat_luong, subsampling=0, dpi=(dpi, dpi))


# ---------------------------------------------------------------- khuôn mặt

_CASCADE = None


def tim_cac_mat(anh: np.ndarray, toan_canh: bool) -> list[tuple[Hop, float]]:
    """Trả về [(khung mặt, độ tin cậy)], rõ nhất đứng đầu.

    toan_canh=True: `anh` là cả tấm hình chụp, khuôn mặt có thể rất nhỏ.
    toan_canh=False: `anh` là riêng tấm ảnh thẻ, khuôn mặt chiếm phần lớn.
    """
    global _CASCADE
    if _CASCADE is None:
        _CASCADE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    xam = cv2.cvtColor(anh, cv2.COLOR_BGR2GRAY)
    canh_dai = max(xam.shape)
    k = 1.0
    if toan_canh:
        if canh_dai > 1600:
            k = 1600 / canh_dai
    elif canh_dai > 1000:  # dò trên ảnh nhỏ cho nhanh
        k = 1000 / canh_dai
    elif canh_dai < 400:  # ảnh quá nhỏ thì phóng lên để dò chính xác hơn
        k = 400 / canh_dai
    if k != 1.0:
        xam = cv2.resize(xam, None, fx=k, fy=k, interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_CUBIC)
    xam = cv2.equalizeHist(xam)
    nho_nhat = max(24, int(min(xam.shape) * (0.025 if toan_canh else 0.08)))
    mats, _, diem = _CASCADE.detectMultiScale3(
        xam, scaleFactor=1.08, minNeighbors=6, minSize=(nho_nhat, nho_nhat), outputRejectLevels=True
    )
    if len(mats) == 0:
        return []
    diem = np.asarray(diem, dtype=np.float64).ravel()
    return [
        ((int(x / k), int(y / k), int(w / k), int(h / k)), float(diem[i]))
        for i in np.argsort(-diem)
        for x, y, w, h in [mats[i]]
    ]


# ---------------------------------------------------------------- cách A: phông nền

def _khop_duong(t: np.ndarray, v: np.ndarray, dung_sai: float = 1.5) -> tuple[float, float, int] | None:
    """Khớp đường thẳng v = a*t + b bằng RANSAC (bỏ qua điểm lạc như tóc, vai).

    Trả về (a, b, số điểm nằm trên đường) hoặc None.
    """
    n = len(t)
    if n < 15:
        return None
    rng = np.random.default_rng(0)
    i, j = rng.integers(0, n, 400), rng.integers(0, n, 400)
    ok = np.abs(t[i] - t[j]) > max(8.0, 0.15 * float(t.max() - t.min()))
    i, j = i[ok], j[ok]
    if len(i) == 0:
        return None
    a = (v[j] - v[i]) / (t[j] - t[i])
    b = v[i] - a * t[i]
    giu = np.abs(a) < 0.47  # ảnh thẻ không nghiêng quá ~25 độ so với khuôn mặt
    a, b = a[giu], b[giu]
    if len(a) == 0:
        return None
    tren_duong = np.abs(v[None, :] - (a[:, None] * t[None, :] + b[:, None])) < dung_sai
    dem = tren_duong.sum(axis=1)
    m = int(np.argmax(dem))
    a2, b2 = np.polyfit(t[tren_duong[m]], v[tren_duong[m]], 1)
    return float(a2), float(b2), int(dem[m])


def tim_khung_theo_phong(anh: np.ndarray, mat: Hop) -> tuple[np.ndarray, float] | None:
    """Tìm 4 góc vùng 3:4 của ảnh thẻ dựa vào phông nền (xanh, trắng...) quanh đầu.

    Phông nền là mảng màu đều bao quanh đầu; mép ngoài của nó chính là mép trên và hai
    mép bên của ảnh thẻ. Mép dưới hay bị áo, dấu đỏ che nên không dò, mà suy ra từ tỉ lệ
    3:4 tính từ mép trên (ảnh 3x4 thì vừa khít, ảnh 2x3 / 4x6 thì bỏ bớt phần ngực).

    Trả về (4 góc, độ đậm màu của phông). Phông càng nhạt (trắng, xám) thì càng dễ lẫn
    với viền giấy ảnh và mặt bàn, nên kết quả càng kém tin cậy - xem PHONG_CO_MAU.
    """
    H, W = anh.shape[:2]
    x, y, fw, fh = mat
    # vùng xét: rộng rãi quanh khuôn mặt, chắc chắn chứa trọn ảnh thẻ
    x0, x1 = max(0, int(x - 1.3 * fw)), min(W, int(x + 2.3 * fw))
    y0, y1 = max(0, int(y - 1.3 * fh)), min(H, int(y + 3.2 * fh))
    F = 150.0  # đưa khuôn mặt về cỡ 150 px để các ngưỡng bên dưới không phụ thuộc cỡ ảnh
    k = F / fw
    vung = cv2.resize(anh[y0:y1, x0:x1], None, fx=k, fy=k, interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_LINEAR)
    vh, vw = vung.shape[:2]
    lab = cv2.cvtColor(cv2.GaussianBlur(vung, (5, 5), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
    lab[..., 0] *= 0.35  # phông nền hay bị loang sáng tối -> coi nhẹ độ sáng, coi trọng màu
    mx, my = (x - x0) * k, (y - y0) * k  # góc trên-trái khung mặt trong vùng xét
    cx = mx + F / 2

    # Lấy mẫu màu ở những chỗ thường là phông nền: hai bên và phía trên đầu.
    ung_vien = []  # (điểm xếp hạng, mặt nạ phông nền)
    mau_da_thu: list[np.ndarray] = []
    for dx, dy in ((0.8, 0.0), (0.8, -0.25), (0.65, -0.35), (0.95, 0.2), (0.5, -0.42), (0.7, 0.4)):
        for dau in (-1, 1):
            px, py = int(cx + dau * dx * F), int(my + dy * F)
            if not (8 <= px < vw - 8 and 8 <= py < vh - 8):
                continue
            o = lab[py - 6 : py + 7, px - 6 : px + 7].reshape(-1, 3)
            if o.std(axis=0).max() > 5:  # ô mẫu không đều màu (tóc, mép ảnh...) -> bỏ
                continue
            mau = np.median(o, axis=0)
            if any(np.linalg.norm(mau - m) < 4 for m in mau_da_thu):
                continue
            mau_da_thu.append(mau)

            giong = (np.linalg.norm(lab - mau, axis=2) < 12).astype(np.uint8)
            giong = cv2.morphologyEx(giong, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
            n, nhan, tk, _ = cv2.connectedComponentsWithStats(giong, connectivity=8)
            # Giữ các mảng nằm gọn trong vùng xét. Mảng chạm mép vùng xét là giấy / mặt bàn.
            giu = [
                i for i in range(1, n)
                if tk[i, cv2.CC_STAT_AREA] >= 0.01 * F * F
                and tk[i, cv2.CC_STAT_LEFT] > 0 and tk[i, cv2.CC_STAT_TOP] > 0
                and tk[i, cv2.CC_STAT_LEFT] + tk[i, cv2.CC_STAT_WIDTH] < vw
                and tk[i, cv2.CC_STAT_TOP] + tk[i, cv2.CC_STAT_HEIGHT] < vh
            ]
            if not giu:
                continue
            lon_nhat = max(tk[i, cv2.CC_STAT_AREA] for i in giu)
            giu = [i for i in giu if tk[i, cv2.CC_STAT_AREA] >= 0.05 * lon_nhat]
            phong = np.isin(nhan, giu)
            if phong.sum() < 0.35 * F * F:
                continue
            # phông nền phải có ở cả hai bên khuôn mặt
            if phong[:, : int(mx)].sum() < 0.04 * F * F or phong[:, int(mx + F) :].sum() < 0.04 * F * F:
                continue
            # Tóc đen cũng là mảng đều màu quanh mặt, nhưng phông nền luôn bao ra ngoài tóc
            # -> xếp hạng theo diện tích khung bao của phần nằm trên cằm.
            ys, xs = np.nonzero(phong[: int(my + F)])
            if len(xs) == 0:
                continue
            do_mau = float(np.hypot(mau[1] - 128, mau[2] - 128))
            ung_vien.append((float((xs.max() - xs.min()) * (ys.max() - ys.min())), phong, do_mau))

    for _, phong, do_mau in sorted(ung_vien, key=lambda u: -u[0]):
        goc = _goc_tu_phong(phong, mx, my, F)
        if goc is None:
            continue
        goc = goc / k + np.array([x0, y0], dtype=np.float32)
        # cả 4 góc phải nằm trong hình (cho phép lố 2%)
        le = 0.02 * max(H, W)
        if (goc[:, 0] < -le).any() or (goc[:, 0] > W + le).any() or (goc[:, 1] < -le).any() or (goc[:, 1] > H + le).any():
            continue
        return goc.astype(np.float32), do_mau
    return None


def _goc_tu_phong(phong: np.ndarray, mx: float, my: float, F: float) -> np.ndarray | None:
    """Từ mặt nạ phông nền, khớp 3 mép (trái, phải, trên) rồi dựng khung 3:4."""
    hang = np.nonzero(phong.any(axis=1))[0].astype(np.float64)
    cot = np.nonzero(phong.any(axis=0))[0].astype(np.float64)
    trai = np.argmax(phong, axis=1)[hang.astype(int)].astype(np.float64)
    phai = (phong.shape[1] - 1 - np.argmax(phong[:, ::-1], axis=1))[hang.astype(int)].astype(np.float64)
    tren = np.argmax(phong, axis=0)[cot.astype(int)].astype(np.float64)

    dl = _khop_duong(hang, trai)  # x = aL*y + bL
    dr = _khop_duong(hang, phai)  # x = aR*y + bR
    dt = _khop_duong(cot, tren)  # y = aT*x + bT
    if not (dl and dr and dt):
        return None
    (aL, bL, nL), (aR, bR, nR), (aT, bT, nT) = dl, dr, dt
    # mép phải đủ dài và thẳng thì mới tin (mép tóc thì lởm chởm, ít điểm thẳng hàng)
    if nL < 0.3 * F or nR < 0.3 * F or nT < 0.6 * F:
        return None
    # hai mép bên gần song song (chụp xiên thì hơi chụm lại), mép trên gần vuông góc với chúng
    if abs(aL - aR) > 0.2 or abs(aT + (aL + aR) / 2) > 0.15:
        return None
    return _dung_khung(aL, bL, aR, bR, aT, bT, mx, my, F)


def _dung_khung(aL: float, bL: float, aR: float, bR: float, aT: float, bT: float, mx: float, my: float, F: float) -> np.ndarray | None:
    """Dựng khung 3:4 từ 3 mép: trái x = aL*y + bL, phải x = aR*y + bR, trên y = aT*x + bT.

    (mx, my) là góc trên-trái khung mặt, F là cỡ khung mặt. Trả về None nếu khuôn mặt
    không nằm ở vị trí / cỡ hợp lý trong khung.
    """

    def giao(a_doc: float, b_doc: float) -> np.ndarray:
        yy = (aT * b_doc + bT) / (1 - aT * a_doc)
        return np.array([a_doc * yy + b_doc, yy])

    tl, tr = giao(aL, bL), giao(aR, bR)
    rong = float(np.linalg.norm(tr - tl))
    # khuôn mặt phải có cỡ và vị trí hợp lý trong khung
    if not (MAT_RONG_MIN <= F / rong <= MAT_RONG_MAX):
        return None
    giua = (mx + F / 2 - tl[0]) / max(tr[0] - tl[0], 1e-6)
    if not (0.3 <= giua <= 0.7) or my - (tl[1] + tr[1]) / 2 < 0.05 * F:
        return None

    cao = rong / TI_LE
    xuong_trai = np.array([aL, 1.0]) / np.hypot(aL, 1.0)
    xuong_phai = np.array([aR, 1.0]) / np.hypot(aR, 1.0)
    return np.array([tl, tr, tr + xuong_phai * cao, tl + xuong_trai * cao], dtype=np.float32)


def tim_khung_theo_mep(anh: np.ndarray, mat: Hop, nhat_ky: dict | None = None) -> tuple[np.ndarray, float] | None:
    """Tìm 4 góc vùng 3:4 của ảnh thẻ dựa vào các đường thẳng dài quanh khuôn mặt.

    Mép ảnh thẻ (mép giấy, khung viền đen, ranh giới phông - viền) là đường thẳng chạy suốt
    chiều cao / chiều ngang tấm ảnh; chữ, dấu đỏ, tóc, vai thì không. Vì vậy cách này dùng
    được cho ảnh phông trắng dán trên hồ sơ, nơi không bám theo màu phông được.
    Nếu có nhiều đường song song (mép giấy rồi tới khung viền) thì lấy đường trong cùng.

    Trả về (4 góc, điểm 0-3 = tổng độ rõ của ba mép trái, phải, trên). Khuôn mặt dò nhầm
    (trên con dấu, trên chữ) hầu như không bao giờ có đủ ba mép thẳng bao quanh.
    """
    H, W = anh.shape[:2]
    x, y, fw, fh = mat
    x0, x1 = max(0, int(x - 1.3 * fw)), min(W, int(x + 2.3 * fw))
    y0, y1 = max(0, int(y - 1.3 * fh)), min(H, int(y + 3.2 * fh))
    F = 150.0
    k = F / fw
    vung = cv2.resize(anh[y0:y1, x0:x1], None, fx=k, fy=k, interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_LINEAR)
    vh, vw = vung.shape[:2]
    mx, my = (x - x0) * k, (y - y0) * k
    cx, cy = mx + F / 2, my + F / 2

    xam = cv2.GaussianBlur(cv2.cvtColor(vung, cv2.COLOR_BGR2GRAY), (3, 3), 0)
    gx = np.abs(cv2.Sobel(xam, cv2.CV_32F, 1, 0, ksize=3))
    gy = np.abs(cv2.Sobel(xam, cv2.CV_32F, 0, 1, ksize=3))
    # điểm mép dọc / mép ngang; nới 1 px để chịu được đường hơi cong, hơi lệch
    doc = cv2.dilate(((gx > MEP_NGUONG) & (gx > 1.5 * gy)).astype(np.uint8), np.ones((1, 3), np.uint8))
    ngang = cv2.dilate(((gy > MEP_NGUONG) & (gy > 1.5 * gx)).astype(np.uint8), np.ones((3, 1), np.uint8))

    # đoạn chắc chắn nằm trong ảnh thẻ theo chiều dọc: từ trán tới ngực
    ya, yb = int(max(0, my - 0.3 * F)), int(min(vh, my + 1.4 * F))
    if yb - ya < 1.2 * F:
        return None

    def chon(do_phu: np.ndarray, a: int, b: int, trong_la_cuoi: bool) -> tuple[int, float] | None:
        """Trong đoạn [a, b): vị trí đường thẳng rõ, nằm trong cùng (gần mặt nhất)."""
        a, b = max(0, a), min(len(do_phu), b)
        if b - a < 3:
            return None
        c = do_phu[a:b]
        if c.max() < 0.5:
            return None
        # Chỉ nhận đường gần rõ bằng đường rõ nhất: mép ảnh chạy suốt chiều cao nên phủ gần
        # 100%, còn mép tóc dài thẳng chỉ phủ 50-75% và sẽ bị loại.
        ro = np.nonzero(c >= max(0.5, 0.88 * c.max()))[0]
        i = int(ro[-1] if trong_la_cuoi else ro[0])
        return a + i, float(c[i])

    tot = None  # (điểm, độ nghiêng, x trái, x phải, y trên)
    for do in range(-8, 9):
        s = float(np.tan(np.radians(do)))
        # kéo xiên để đường x = xl + s*(y - cy) thành đường thẳng đứng
        dv = cv2.warpAffine(doc, np.float32([[1, -s, s * cy], [0, 1, 0]]), (vw, vh), flags=cv2.INTER_NEAREST)
        phu_doc = dv[ya:yb].mean(axis=0)
        trai = chon(phu_doc, int(cx - 1.5 * F), int(cx - 0.6 * F), True)
        phai = chon(phu_doc, int(cx + 0.6 * F), int(cx + 1.5 * F), False)
        if nhat_ky is not None:  # chỉ để gỡ lỗi: độ phủ lớn nhất mỗi bên theo từng góc nghiêng
            a, b = max(0, int(cx - 1.5 * F)), int(cx - 0.6 * F)
            c, d = int(cx + 0.6 * F), min(vw, int(cx + 1.5 * F))
            nhat_ky[do] = (round(float(phu_doc[a:b].max()) if b > a else -1, 2), round(float(phu_doc[c:d].max()) if d > c else -1, 2))
        if not (trai and phai):
            continue
        # kéo xiên để đường y = yt - s*(x - cx) thành đường nằm ngang
        dh = cv2.warpAffine(ngang, np.float32([[1, 0, 0], [s, 1, -s * cx]]), (vw, vh), flags=cv2.INTER_NEAREST)
        tren = chon(dh[:, trai[0] + 4 : phai[0] - 4].mean(axis=1), int(my - 1.05 * F), int(my - 0.1 * F), True)
        if not tren:
            continue
        diem = trai[1] + phai[1] + tren[1]
        if tot is None or diem > tot[0]:
            tot = (diem, s, trai[0], phai[0], tren[0])
    if tot is None:
        return None
    diem, s, xl, xr, yt = tot
    goc = _dung_khung(s, xl - s * cy, s, xr - s * cy, -s, yt + s * cx, mx, my, F)
    if goc is None:
        return None
    goc = goc / k + np.array([x0, y0], dtype=np.float32)
    le = 0.02 * max(H, W)
    if (goc[:, 0] < -le).any() or (goc[:, 0] > W + le).any() or (goc[:, 1] < -le).any() or (goc[:, 1] > H + le).any():
        return None
    return goc.astype(np.float32), diem


# ---------------------------------------------------------------- cách B: nền bàn

def _sap_xep_goc(pts: np.ndarray) -> np.ndarray:
    """Trả về 4 góc theo thứ tự: trên-trái, trên-phải, dưới-phải, dưới-trái."""
    pts = pts.astype(np.float32)
    s = pts.sum(axis=1)
    d = pts[:, 0] - pts[:, 1]
    return np.array(
        [pts[np.argmin(s)], pts[np.argmax(d)], pts[np.argmax(s)], pts[np.argmin(d)]],
        dtype=np.float32,
    )


def tim_to_anh(anh: np.ndarray) -> list[np.ndarray]:
    """Tìm các tờ giấy ảnh (hình chữ nhật nằm gọn trên nền trơn). Trả về danh sách 4 góc.

    Dò theo đường mép của tờ giấy (mép giấy, bóng đổ) chứ không theo màu, nên dùng được cả
    khi ảnh thẻ phông trắng, áo trắng nằm trên bàn trắng. Tờ lớn nhất đứng đầu; nơi gọi
    phải tự kiểm tra bên trong có khuôn mặt hay không.
    """
    h, w = anh.shape[:2]
    k = min(1.0, DETECT_MAX / max(h, w))
    nho = cv2.resize(anh, None, fx=k, fy=k, interpolation=cv2.INTER_AREA) if k < 1 else anh
    nh, nw = nho.shape[:2]

    lab = cv2.cvtColor(cv2.GaussianBlur(nho, (5, 5), 0), cv2.COLOR_BGR2LAB)
    canh = np.zeros((nh, nw), np.uint8)
    for i in range(3):  # mép sáng-tối lẫn mép đổi màu
        canh |= cv2.Canny(lab[..., i], 12, 36)
    # nối các đoạn mép đứt để đường bao tờ giấy khép kín
    canh = cv2.morphologyEx(cv2.dilate(canh, np.ones((3, 3), np.uint8)), cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))

    ung_vien = []
    cts, _ = cv2.findContours(canh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for ct in cts:
        bao = cv2.convexHull(ct)
        dt = cv2.contourArea(bao)
        if not (0.003 * nh * nw <= dt <= 0.6 * nh * nw):
            continue
        hop = cv2.minAreaRect(bao)
        rw, rh = hop[1]
        # Mép trắng trên nền trắng có khi mất hẳn một cạnh, đường bao hở nên chỉ đầy ~85%.
        if min(rw, rh) < 40 or dt / (rw * rh) < 0.82:
            continue  # không ra hình chữ nhật
        if not (0.55 <= min(rw, rh) / max(rw, rh) <= 0.92):
            continue  # ảnh thẻ có tỉ lệ 3:4 hoặc 2:3
        x, y, bw, bh = cv2.boundingRect(bao)
        if x < 2 or y < 2 or x + bw > nw - 2 or y + bh > nh - 2:
            continue  # bị mép hình cắt
        # Ảnh chụp xiên thì tờ ảnh thành hình thang -> ưu tiên lấy đúng 4 góc thật.
        goc = _sap_xep_goc(cv2.boxPoints(hop))
        chu_vi = cv2.arcLength(bao, True)
        for eps in (0.02, 0.03, 0.04, 0.05):
            da_giac = cv2.approxPolyDP(bao, eps * chu_vi, True)
            if len(da_giac) == 4 and cv2.contourArea(da_giac) > 0.93 * dt:
                goc = _sap_xep_goc(da_giac.reshape(4, 2))
                break
        ung_vien.append((dt, goc / k))
    return [g for _, g in sorted(ung_vien, key=lambda u: -u[0])]


def khung_trong_to(to: np.ndarray, mat: Hop) -> np.ndarray:
    """Chọn vùng 3:4 bên trong tờ ảnh đã nắn thẳng, đúng chiều. Trả về 4 góc trên `to`.

    Bỏ viền trắng của giấy ảnh nếu thấy rõ ranh giới giữa viền và hình (phông xám, phông
    màu). Phông trắng thì viền và phông liền nhau, không tách được, nên chỉ bỏ một dải mỏng
    sát mép để hết bóng mép giấy.
    """
    h, w = to.shape[:2]
    i0 = max(2, int(round(0.02 * w)))
    lab = cv2.cvtColor(cv2.GaussianBlur(to, (5, 5), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
    d = max(2, int(round(0.015 * w)))
    vanh = np.concatenate([
        lab[i0 : i0 + d, i0 : w - i0].reshape(-1, 3), lab[h - i0 - d : h - i0, i0 : w - i0].reshape(-1, 3),
        lab[i0 : h - i0, i0 : i0 + d].reshape(-1, 3), lab[i0 : h - i0, w - i0 - d : w - i0].reshape(-1, 3),
    ])
    khac = np.linalg.norm(lab - np.median(vanh, axis=0), axis=2) > 7  # khác màu viền giấy

    def het_vien(dai: np.ndarray, toi_da: int) -> int:
        """Vị trí đầu tiên (tính từ mép) mà hơn nửa dải đã là hình chứ không còn là viền."""
        ti_le_khac = dai.mean(axis=1)
        for i in range(i0, toi_da):
            if ti_le_khac[i] > 0.5 and ti_le_khac[i : i + 3].min() > 0.5:
                return i + 1
        return i0

    gh_x, gh_y = int(0.09 * w), int(0.09 * h)  # viền giấy ảnh không dày quá 9% mỗi bên
    y0 = het_vien(khac[:, i0 : w - i0], gh_y)
    y1 = h - het_vien(khac[::-1, i0 : w - i0], gh_y)
    x0 = het_vien(khac[i0 : h - i0].T, gh_x)
    x1 = w - het_vien(khac[i0 : h - i0, ::-1].T, gh_x)

    rong, cao = x1 - x0, y1 - y0
    if rong / cao > TI_LE:  # thừa chiều ngang -> cắt bớt hai bên, căn theo mặt
        moi = cao * TI_LE
        xa = min(max(mat[0] + mat[2] / 2 - moi / 2, x0), x1 - moi)
        x0, x1 = xa, xa + moi
    else:  # thừa chiều dọc (ảnh 2x3, 4x6...) -> giữ phần đầu, bỏ bớt phần ngực
        y1 = y0 + rong / TI_LE
    return np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], dtype=np.float32)


def ve_anh_goc(diem: np.ndarray, M: np.ndarray, ma_xoay: int | None, co_truoc_xoay: tuple[int, int]) -> np.ndarray:
    """Đổi toạ độ điểm trên tờ ảnh (đã nắn bằng M rồi xoay bằng `ma_xoay`) về ảnh gốc."""
    h, w = co_truoc_xoay
    p = np.asarray(diem, dtype=np.float32).reshape(-1, 2)
    x, y = p[:, 0].copy(), p[:, 1].copy()
    if ma_xoay == cv2.ROTATE_90_CLOCKWISE:
        x, y = y, h - 1 - x
    elif ma_xoay == cv2.ROTATE_90_COUNTERCLOCKWISE:
        x, y = w - 1 - y, x
    elif ma_xoay == cv2.ROTATE_180:
        x, y = w - 1 - x, h - 1 - y
    return cv2.perspectiveTransform(np.c_[x, y].astype(np.float32)[None], np.linalg.inv(M))[0]


def goc_cua_hop(hop: Hop) -> np.ndarray:
    x, y, w, h = hop
    return np.array([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], dtype=np.float32)


def xoay_tam_anh(anh: np.ndarray) -> tuple[np.ndarray, Hop | None, int | None]:
    """Xoay tấm ảnh thẻ đã nắn thẳng cho mặt hướng lên. Trả về (ảnh, khung mặt, mã xoay).

    Ảnh thẻ luôn dọc, nên khung dọc chỉ có thể đúng chiều hoặc lộn ngược, khung ngang
    chỉ có thể xoay trái hoặc phải.
    """
    h, w = anh.shape[:2]
    cac_chieu = [cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_90_COUNTERCLOCKWISE] if w > h else [None, cv2.ROTATE_180]
    tot_nhat = None
    for ma in cac_chieu:
        thu = anh if ma is None else cv2.rotate(anh, ma)
        ds = tim_cac_mat(thu, toan_canh=False)
        if not ds:
            continue
        (hop, diem) = ds[0]
        diem += 0.5 if ma is None else 0
        # khuôn mặt thật nằm ở nửa trên; mặt dò nhầm khi ảnh lộn ngược thường ở nửa dưới
        if hop[1] + hop[3] / 2 < 0.5 * thu.shape[0]:
            diem += 3
        if tot_nhat is None or diem > tot_nhat[0]:
            tot_nhat = (diem, thu, hop, ma)
    if tot_nhat:
        return tot_nhat[1], tot_nhat[2], tot_nhat[3]
    return (anh if cac_chieu[0] is None else cv2.rotate(anh, cac_chieu[0])), None, cac_chieu[0]


# ---------------------------------------------------------------- cách C: quanh mặt

def cat_theo_mat(anh: np.ndarray, mat: Hop) -> tuple[np.ndarray, np.ndarray]:
    """Không thấy khung ảnh -> dựng khung 3:4 quanh khuôn mặt theo bố cục chuẩn."""
    H, W = anh.shape[:2]
    x, y, fw, fh = mat
    rong = fw / MAT_RONG
    cao = rong / TI_LE
    ti = min(1.0, W / rong, H / cao)  # không vượt ra ngoài ảnh
    rong, cao = rong * ti, cao * ti
    x0 = min(max(x + fw / 2 - rong / 2, 0), W - rong)
    y0 = min(max(y - MAT_Y * cao, 0), H - cao)
    x0, y0, rong, cao = (int(round(v)) for v in (x0, y0, rong, cao))
    goc = np.array([[x0, y0], [x0 + rong, y0], [x0 + rong, y0 + cao], [x0, y0 + cao]], dtype=np.float32)
    return anh[y0 : y0 + cao, x0 : x0 + rong], goc


# ---------------------------------------------------------------- nắn / hoàn thiện

def nan_thang(anh: np.ndarray, goc: np.ndarray, ti_le: float | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Cắt vùng 4 góc thành hình chữ nhật thẳng (ép đúng tỉ lệ rộng/cao nếu có `ti_le`).

    Trả về (ảnh đã nắn, ma trận biến đổi từ ảnh gốc sang ảnh đã nắn).
    """
    tl, tr, br, bl = goc
    rong = int(round(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl))))
    cao = int(round(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr))))
    if ti_le:
        cao = int(round(rong / ti_le))
    dich = np.array([[0, 0], [rong - 1, 0], [rong - 1, cao - 1], [0, cao - 1]], dtype=np.float32)
    M = cv2.getPerspectiveTransform(goc.astype(np.float32), dich)
    return cv2.warpPerspective(anh, M, (rong, cao), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE), M


# ---------------------------------------------------------------- xóa dấu đỏ

def tim_vong_dau(nen: np.ndarray, goc: np.ndarray) -> list[tuple[float, float, float]]:
    """Tìm con dấu đỏ đóng đè lên ảnh thẻ. Trả về [(tâm x, tâm y, bán kính)] trên `nen`.

    Phần dấu nằm trên giấy trắng rất dễ thấy (mực đỏ thẫm), từ cung tròn đó suy ra cả
    vòng tròn con dấu, kể cả phần đang đè lên ảnh thẻ. Không có dấu thì trả về [].
    """
    H, W = nen.shape[:2]
    rong = float(np.linalg.norm(goc[1] - goc[0]))
    x0, y0 = np.floor(goc.min(axis=0) - 1.1 * rong).astype(int)
    x1, y1 = np.ceil(goc.max(axis=0) + 1.1 * rong).astype(int)
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(W, x1), min(H, y1)
    k = 300.0 / rong  # đưa ảnh thẻ về bề ngang 300 px
    canh = cv2.resize(nen[y0:y1, x0:x1], None, fx=k, fy=k, interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_LINEAR)
    a = cv2.cvtColor(canh, cv2.COLOR_BGR2LAB)[..., 1].astype(np.int16) - 128
    sac = cv2.cvtColor(canh, cv2.COLOR_BGR2HSV)[..., 0]
    # mực dấu: đỏ thẫm (sắc độ ~175-180 và 0-5); bìa hồ sơ / áo cam có sắc độ 8-16 nên không dính
    muc = ((a > 20) & ((sac >= 168) | (sac <= 6))).astype(np.uint8)

    tu_giac = ((goc - np.array([x0, y0])) * k).astype(np.float32)
    trong_anh = np.zeros(muc.shape, np.uint8)
    cv2.fillPoly(trong_anh, [np.round(tu_giac).astype(np.int32)], 1)
    muc[cv2.dilate(trong_anh, np.ones((7, 7), np.uint8)) > 0] = 0  # chỉ xét mực trên giấy

    # gộp vành tròn + chữ trong dấu thành một khối
    khoi = cv2.morphologyEx(muc, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)), iterations=2)
    n, nhan, tk, _ = cv2.connectedComponentsWithStats(khoi, connectivity=8)
    vong = []
    for i in range(1, n):
        if tk[i, cv2.CC_STAT_AREA] < 2500:
            continue  # quá nhỏ để là con dấu (chữ ký, vết mực...)
        # Phần dấu thấy được trên giấy là hình tròn bị ảnh thẻ che mất một góc, nên mọi đỉnh
        # của bao lồi đều nằm trên vành dấu -> khớp đường tròn qua các đỉnh đó.
        cung = cv2.convexHull(np.argwhere(nhan == i)[:, ::-1].astype(np.float32)).reshape(-1, 2)
        tron = None
        for _ in range(3):  # khớp, bỏ điểm lạc (đốm mực văng ra ngoài), khớp lại
            if len(cung) < 6:
                break
            # Kasa: x² + y² + A x + B y + C = 0
            A = np.c_[cung, np.ones(len(cung))]
            (pa, pb, pc), *_ = np.linalg.lstsq(A, -(cung**2).sum(axis=1), rcond=None)
            cx, cy = -pa / 2, -pb / 2
            r2 = cx * cx + cy * cy - pc
            if r2 <= 0:
                break
            r = float(np.sqrt(r2))
            lech = np.abs(np.hypot(cung[:, 0] - cx, cung[:, 1] - cy) - r)
            if lech.max() < 0.05 * r:
                tron = (float(cx), float(cy), r)
                break
            cung = cung[lech < max(0.05 * r, float(np.percentile(lech, 80)))]
        # con dấu tròn có đường kính 36-38 mm, phần hình của ảnh thẻ rộng 25-40 mm
        if tron is None or not (0.4 * 300 <= tron[2] <= 1.0 * 300):
            continue
        # dấu phải đè lên ảnh thẻ một phần đáng kể
        dia = np.zeros(muc.shape, np.uint8)
        cv2.circle(dia, (int(round(tron[0])), int(round(tron[1]))), int(round(tron[2])), 1, -1)
        if (dia & trong_anh).sum() < 0.01 * trong_anh.sum():
            continue
        vong.append((tron[0] / k + x0, tron[1] / k + y0, tron[2] / k))
    return vong


def xoa_dau_do(
    thang: np.ndarray, M: np.ndarray, vong: list[tuple[float, float, float]], mat: tuple[float, float, float, float]
) -> tuple[np.ndarray, np.ndarray]:
    """Xóa phần dấu đỏ đè lên ảnh thẻ đã nắn thẳng. Trả về (ảnh đã xóa, mặt nạ vùng đã vá).

    Chỉ đụng tới phần ảnh nằm trong vòng tròn con dấu, và không bao giờ đụng vào khuôn mặt.
    `vong` tính trên ảnh gốc (M đổi từ ảnh gốc sang `thang`); `mat` là khung mặt
    (x trái, y trên, x phải, y dưới) tính trên `thang`.
    """
    h, w = thang.shape[:2]
    vung = np.zeros((h, w), np.uint8)
    t = np.linspace(0, 2 * np.pi, 90, endpoint=False)
    for cx, cy, r in vong:
        diem = np.c_[cx + 1.12 * r * np.cos(t), cy + 1.12 * r * np.sin(t)].astype(np.float32)
        cv2.fillPoly(vung, [np.round(cv2.perspectiveTransform(diem[None], M)[0]).astype(np.int32)], 1)
    trong_dau = vung.copy()
    # Bảo vệ khuôn mặt (mắt, mũi, môi): hình bầu dục nằm trong khung dò mặt.
    mx0, my0, mx1, my1 = mat
    tam_mat = (int(round((mx0 + mx1) / 2)), int(round((my0 + my1) / 2)))
    cv2.ellipse(vung, tam_mat, (int(0.46 * (mx1 - mx0)), int(0.56 * (my1 - my0))), 0, 0, 360, 0, -1)
    if not vung.any():
        return thang, vung

    mo = cv2.GaussianBlur(thang, (3, 3), 0)
    lab = cv2.cvtColor(mo, cv2.COLOR_BGR2LAB)
    L, a, b = (lab[..., i].astype(np.float32) for i in range(3))
    sac = cv2.cvtColor(mo, cv2.COLOR_BGR2HSV)[..., 0]

    # 1) Mực đỏ rõ (trên nền sáng, da, vải nhạt): đúng màu mực dấu như khi nằm trên giấy.
    do = (a - 128 > 18) & ((sac >= 168) | (sac <= 6))
    # 2) Nét mực mảnh trên nền màu (phông xanh...): đỏ hơn hẳn vùng lân cận.
    kk = max(9, int(w * 0.06) | 1)
    net = (a - cv2.medianBlur(lab[..., 1], kk).astype(np.float32)) > 4.5
    # 3) Mực trên vải tối: không còn đỏ rõ mà thành lớp ánh nâu đỏ / vàng nhạt. So với chính
    #    lớp vải đó ở ngoài vòng dấu (phía dưới khuôn mặt) để biết màu vải "sạch".
    toi = L < 110
    xa_dau = cv2.dilate(trong_dau, np.ones((2 * (w // 30) + 1,) * 2, np.uint8)) == 0
    mau = toi & xa_dau
    mau[: max(0, int(my1))] = False
    am = np.zeros_like(net)
    if mau.sum() >= 300:
        rL, ra, rb = (float(np.median(c[mau])) for c in (L, a, b))
        da, db = a - ra, b - rb
        am = toi & (
            (da > 2.5)  # ngả đỏ
            | (db > 3)  # ngả nâu / vàng / ô-liu
            # sáng hơn vải mà không ngả xanh (vải jean, sọc xanh... thì ngả xanh -> để yên)
            | (((L - rL) > 5) & (db > 0.5))
        )

    mat_na = ((do | net | am) & (vung > 0)).astype(np.uint8)
    mat_na = cv2.morphologyEx(mat_na, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))  # bỏ nhiễu lấm tấm
    if mat_na.sum() < 0.0005 * h * w:
        return thang, np.zeros((h, w), np.uint8)

    # 4) Mảng trắng nhỏ ở sát mép, nằm trong vòng dấu: góc ảnh thẻ bị bong / lẹm, lộ giấy bên
    #    dưới. Nếu để lại, bước vá sẽ kéo màu trắng đó loang vào áo.
    trang = ((L > 190) & (np.abs(a - 128) < 12) & (np.abs(b - 128) < 14) & (vung > 0)).astype(np.uint8)
    n, nhan, tk, _ = cv2.connectedComponentsWithStats(trang, connectivity=8)
    for i in range(1, n):
        x0, y0, bw, bh, dt = tk[i]
        if dt < 0.015 * h * w and (x0 == 0 or y0 == 0 or x0 + bw == w or y0 + bh == h):
            mat_na[nhan == i] = 1
    # nối các nét đứt (vành chấm bi, chữ), rồi nới rộng để phủ cả viền mờ của nét mực
    noi = 2 * max(1, w // 130) + 1
    mat_na = cv2.morphologyEx(mat_na, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (noi, noi)))
    no = 2 * max(1, w // 200) + 3
    mat_na = cv2.dilate(mat_na, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (no, no))) & vung

    # Nét mảnh: vá kiểu nối tiếp đường nét xung quanh (giữ được ranh giới vai, cổ áo).
    sua = cv2.inpaint(thang, mat_na * 255, max(3, w // 110), cv2.INPAINT_TELEA)
    # Mảng dày (lõi con dấu, chữ đậm): kiểu vá trên hay kéo cả mực còn sót ở rìa vào thành
    # các mảng loang. Thay bằng màu trung bình mượt của phần vải sạch xung quanh.
    co_day = 2 * (w // 130) + 3
    day = cv2.morphologyEx(mat_na, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (co_day, co_day)))
    if day.any():
        day = cv2.dilate(day, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))) & mat_na
        # nguồn màu: ngoài vùng dấu (nới thêm để chắc chắn sạch mực) và không sát mép ảnh
        cam = cv2.dilate(mat_na, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (no + 4, no + 4))) > 0
        le = max(2, int(round(0.015 * w)))
        cam[:le], cam[-le:], cam[:, :le], cam[:, -le:] = True, True, True, True
        sua = _lap_theo_chat_lieu(thang, sua, day > 0, ~cam, lab)
    return sua, mat_na


def _lap_theo_chat_lieu(goc: np.ndarray, tho: np.ndarray, vung: np.ndarray, sach: np.ndarray, lab_goc: np.ndarray) -> np.ndarray:
    """Lấp `vung` bằng màu mượt của đúng chất liệu nằm dưới nó.

    `tho` là bản vá thô (đã có màu gần đúng tại từng chỗ nhưng loang lổ). Các điểm sạch quanh
    vùng dấu được chia nhóm theo màu (áo, phông nền, vải jean...). Mỗi điểm cần lấp được xếp
    vào nhóm có màu gần với bản vá thô nhất, rồi chỉ lấy màu từ các điểm sạch cùng nhóm.
    Nhờ vậy áo đen không bị pha màu phông và ngược lại. Da người không được làm nguồn màu,
    vì dấu gần như luôn nằm trên áo / phông chứ không nằm trên da.
    """
    h, w = vung.shape
    L, a, b = (lab_goc[..., i].astype(np.float32) for i in range(3))
    da_nguoi = (L >= 100) & (a - 128 > 8) & (b - 128 > 10)
    am_hong = (L >= 100) & (a - 128 > 5) & (b - 128 <= 10)  # quầng mực nhạt còn sót quanh nét dấu
    gan = cv2.dilate(vung.astype(np.uint8), np.ones((2 * (w // 4) + 1,) * 2, np.uint8)) > 0
    nguon = sach & gan & ~da_nguoi & ~am_hong
    if nguon.sum() < 200:
        return tho

    def dac_trung(lab: np.ndarray) -> np.ndarray:  # coi nhẹ độ sáng để bóng đổ không tách nhóm
        f = lab.reshape(-1, 3).astype(np.float32)
        f[:, 0] *= 0.6
        return f

    mau_nguon = dac_trung(lab_goc)[nguon.ravel()]
    lay = mau_nguon[:: max(1, len(mau_nguon) // 6000)]
    so_nhom = min(5, len(lay))
    cv2.setRNGSeed(0)
    _, _, tam = cv2.kmeans(lay, so_nhom, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5), 3, cv2.KMEANS_PP_CENTERS)

    def nhom_gan_nhat(f: np.ndarray) -> np.ndarray:
        return np.argmin(((f[:, None, :] - tam[None]) ** 2).sum(axis=2), axis=1)

    nhom_nguon = np.full((h, w), -1, np.int32)
    nhom_nguon[nguon] = nhom_gan_nhat(mau_nguon)
    lab_tho = cv2.cvtColor(cv2.GaussianBlur(tho, (5, 5), 0), cv2.COLOR_BGR2LAB)
    # Bản vá thô có chỗ sai hẳn (bị kéo màu từ mép ảnh, từ tóc). Dùng chính màu của điểm đang
    # dính mực để loại các nhóm vô lý: mực đỏ tươi và sáng thì bên dưới phải là nền sáng;
    # điểm dính mực mà vẫn tối thì bên dưới không thể là nền sáng hơn nó quá nhiều.
    sang_nhom = tam[:, 0] / 0.6
    kc = ((dac_trung(lab_tho)[vung.ravel()][:, None, :] - tam[None]) ** 2).sum(axis=2)
    L_muc, a_muc = L[vung], a[vung]
    do_tuoi = (L_muc >= 110) & (a_muc - 128 > 12)  # mực đỏ tươi trên nền sáng
    toi_xin = (L_muc < 90) & (a_muc - 128 < 12)  # lớp ánh mực trên vải tối
    kc[do_tuoi[:, None] & (sang_nhom < 110)[None]] += 1e6
    kc[toi_xin[:, None] & (sang_nhom[None] > L_muc[:, None] + 60)] += 1e6
    nhom_dich = np.full((h, w), 255, np.uint8)
    nhom_dich[vung] = np.argmin(kc, axis=1)
    nhom_dich = cv2.medianBlur(nhom_dich, 5)  # làm gọn ranh giới giữa các nhóm

    ra = tho
    for i in range(so_nhom):
        can_lap = vung & (nhom_dich == i)
        if can_lap.any():
            ra = _lap_muot(goc, ra, can_lap, nhom_nguon == i, max(2.0, w / 150))
    return ra


def _lap_muot(nguon: np.ndarray, dich: np.ndarray, vung: np.ndarray, sach: np.ndarray, sigma: float) -> np.ndarray:
    """Lấp `vung` trên `dich` bằng trung bình có trọng số của các điểm `sach` trên `nguon`.

    Làm từ gần ra xa: điểm nào đã có đủ điểm sạch ở gần thì lấy màu ngay ở mức mờ nhỏ (giữ
    được chuyển sắc cục bộ), điểm nằm sâu trong mảng lớn thì dùng mức mờ lớn hơn.
    """
    ra = dich.astype(np.float32)
    anh = nguon.astype(np.float32)
    trong_so = sach.astype(np.float32)
    con = vung.copy()
    for _ in range(7):
        w = cv2.GaussianBlur(trong_so, (0, 0), sigma)
        tong = cv2.GaussianBlur(anh * trong_so[..., None], (0, 0), sigma)
        duoc = con & (w > 0.15)
        ra[duoc] = tong[duoc] / w[duoc, None]
        con &= ~duoc
        if not con.any():
            break
        sigma *= 2
    return np.clip(ra, 0, 255).astype(np.uint8)


def bo_mep(anh: np.ndarray, ti_le_bo: float) -> np.ndarray:
    """Cắt bỏ một dải mỏng quanh mép (viền trắng, bóng) mà vẫn giữ nguyên tỉ lệ khung."""
    h, w = anh.shape[:2]
    lx, ly = int(round(w * ti_le_bo)), int(round(h * ti_le_bo))
    return anh[ly : h - ly, lx : w - lx]


def mau_giay_quanh(nen: np.ndarray, goc: np.ndarray, vong: list[tuple[float, float, float]] | None) -> np.ndarray | None:
    """Màu (BGR) của giấy trắng ngay quanh ảnh thẻ: viền giấy ảnh, tờ hồ sơ.

    Đây là mốc "màu trắng thật" dưới đúng ánh đèn lúc chụp, dùng để cân màu và chỉnh sáng.
    Trả về None nếu quanh ảnh không có gì trắng (mặt bàn gỗ, bìa màu...).
    """
    H, W = nen.shape[:2]
    tam = goc.mean(axis=0)
    dai = np.zeros((H, W), np.uint8)
    cv2.fillPoly(dai, [np.round(tam + (goc - tam) * 1.24).astype(np.int32)], 1)
    cv2.fillPoly(dai, [np.round(tam + (goc - tam) * 1.08).astype(np.int32)], 0)
    for cx, cy, r in vong or []:  # bỏ phần bị con dấu đỏ che
        cv2.circle(dai, (int(round(cx)), int(round(cy))), int(round(1.15 * r)), 0, -1)
    x, y, bw, bh = cv2.boundingRect(dai)
    if bw == 0:
        return None
    vung, dai = nen[y : y + bh, x : x + bw], dai[y : y + bh, x : x + bw] > 0
    lab = cv2.cvtColor(vung, cv2.COLOR_BGR2LAB).astype(np.float32)
    trang = dai & (np.hypot(lab[..., 1] - 128, lab[..., 2] - 128) < 12) & (lab[..., 0] > 120)
    if trang.sum() < 300:
        return None
    sang = lab[..., 0][trang]
    return np.median(vung[trang][sang >= np.percentile(sang, 75)], axis=0).astype(np.float32)  # bỏ chữ, bóng


def hoan_thien(
    anh: np.ndarray,
    kich_thuoc: tuple[int, int],
    muc: int,
    trang_giay: np.ndarray | None = None,
    mat: tuple[float, float, float, float] | None = None,
) -> np.ndarray:
    """Đưa ảnh về kích thước in rồi chỉnh cho đẹp theo `muc` (0 = không chỉnh ... 3 = mạnh).

    trang_giay: màu giấy trắng quanh ảnh (xem mau_giay_quanh) - mốc để cân màu, chỉnh sáng.
    mat: khung mặt theo tỉ lệ 0-1 của ảnh (x trái, y trên, x phải, y dưới) - để đo độ sáng da.
    """
    rong, cao = kich_thuoc
    noi_suy = cv2.INTER_AREA if anh.shape[1] > rong else cv2.INTER_LANCZOS4
    ra = cv2.resize(anh, (rong, cao), interpolation=noi_suy)
    if muc <= 0:
        return ra
    manh = {1: 0.5, 2: 0.8}.get(muc, 1.0)

    # 1) Khử nhiễu hạt của giấy ảnh / ảnh nén trước, để bước tăng nét không làm hạt nổi lên.
    #    Làm nhẹ tay: khử mạnh thì phông nền loang thành mảng, da mặt trông như tranh vẽ.
    if muc >= 2:
        h_nhieu = 2 if muc == 2 else 3
        ra = cv2.fastNlMeansDenoisingColored(ra, None, h_nhieu, h_nhieu, 5, 15)

    x = ra.astype(np.float32)
    # 2) Cân màu + chỉnh sáng theo giấy trắng: giấy phải ra trắng trung tính, sáng ~240.
    if trang_giay is not None:
        tb = float(trang_giay.mean())
        he_so = np.clip(tb / trang_giay, 0.9, 1.12) * float(np.clip(240 / tb, 0.9, 1.3))
        he_so = 1 + manh * (he_so - 1)
        dinh = float(np.percentile((x * he_so).max(axis=2), 99.5))
        if dinh > 252:  # không để vùng sáng nhất bị cháy
            he_so = he_so * (252 / dinh)
        x = x * he_so

    lab = cv2.cvtColor(np.clip(x, 0, 255).astype(np.uint8), cv2.COLOR_BGR2LAB).astype(np.float32)
    L = lab[..., 0]
    # 3) Kéo giãn tương phản nhẹ: điểm tối nhất về gần đen, điểm sáng nhất lên thêm một chút.
    lo, hi = np.percentile(L, (0.5, 99.5))
    if hi - lo > 40:
        lo_moi, hi_moi = min(lo, 10.0), max(hi, min(250.0, hi + 12 * manh))
        L = (L - lo) * (hi_moi - lo_moi) / (hi - lo) + lo_moi
    # 4) Da mặt bị tối thì nâng vùng trung gian lên (không ép mọi người về cùng một độ sáng).
    if mat is not None:
        fx0, fy0, fx1, fy1 = mat
        cxm, cym, bw, bh = (fx0 + fx1) / 2 * rong, (fy0 + fy1) / 2 * cao, (fx1 - fx0) * rong, (fy1 - fy0) * cao
        o = L[int(max(0, cym - bh / 4)) : int(cym + bh / 4), int(max(0, cxm - bw / 4)) : int(cxm + bw / 4)]
        if o.size > 50:
            da = float(np.median(o))
            if 40 < da < 150:
                dich = da + manh * 0.6 * (150 - da)
                L = 255 * np.power(np.clip(L, 0, 255) / 255, np.log(dich / 255) / np.log(da / 255))
    lab[..., 0] = L
    # 5) Màu tươi hơn một chút (rất nhẹ, vì ảnh in vốn đã hay ngả cam ở da).
    lab[..., 1:] = 128 + (lab[..., 1:] - 128) * (1 + 0.04 * manh)
    ra = cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)

    # 6) Tăng nét: chỉ nhấn vào chi tiết thật (chênh lệch đủ lớn), bỏ qua nhiễu li ti.
    mo = cv2.GaussianBlur(ra, (0, 0), 1.0)
    chi_tiet = ra.astype(np.float32) - mo
    chi_tiet[np.abs(chi_tiet) < 1.5] = 0
    return np.clip(ra + (0.2 + 0.3 * muc) * chi_tiet, 0, 255).astype(np.uint8)


# ---------------------------------------------------------------- xử lý 1 ảnh

def xu_ly(anh: np.ndarray, kich_thuoc: tuple[int, int], bo_vien: float, muc: int = 2, xoa_dau: bool = True) -> KetQua | None:
    """Cắt ảnh thẻ 3:4 từ `anh`. `muc`: mức chỉnh đẹp 0-3 (xem hoan_thien)."""

    def hoan_tat(nen: np.ndarray, goc: np.ndarray, goc_mat: np.ndarray, ghi_chu: str = "") -> KetQua:
        """Nắn vùng `goc` (4 góc 3:4 trên `nen`), xóa dấu đỏ nếu có, rồi hoàn thiện."""
        thang, M = nan_thang(nen, goc, TI_LE)
        m = cv2.perspectiveTransform(goc_mat[None].astype(np.float32), M)[0]
        hop_mat = (m[:, 0].min(), m[:, 1].min(), m[:, 0].max(), m[:, 1].max())  # khung mặt trên `thang`
        vong, da_xoa, go_loi = None, False, None
        if xoa_dau:
            vong = tim_vong_dau(nen, goc) or None
            if vong:
                truoc = thang
                thang, da_va = xoa_dau_do(thang, M, vong, hop_mat)
                da_xoa = bool(da_va.any())
                go_loi = {"truoc": truoc, "sau": thang, "mat_na": da_va}
        h, w = thang.shape[:2]
        mat_ti_le = None
        if hop_mat[2] - hop_mat[0] > 0.2 * w:  # có khung mặt thật (không phải khung giả khi không dò ra mặt)
            mat_ti_le = (hop_mat[0] / w, hop_mat[1] / h, hop_mat[2] / w, hop_mat[3] / h)
        trang = mau_giay_quanh(nen, goc, vong) if muc > 0 else None
        ra = hoan_thien(bo_mep(thang, bo_vien), kich_thuoc, muc, trang, mat_ti_le)
        return KetQua(ra, nen, goc, ghi_chu, vong, da_xoa, go_loi)

    # --- A. Khuôn mặt + phông nền, thử lần lượt 4 chiều xoay của tấm hình.
    khung_tot = None  # (điểm, ảnh đã xoay, 4 góc, khung mặt, độ đậm màu phông)
    mat_tot = None  # (điểm, ảnh đã xoay, khung mặt) - dùng cho cách C
    cac_luot = []  # (ảnh đã xoay, các khuôn mặt ứng viên) của từng chiều xoay đã thử
    for ma in CAC_CHIEU:
        thu = anh if ma is None else cv2.rotate(anh, ma)
        cac_mat = tim_cac_mat(thu, toan_canh=True)[:SO_MAT_THU]
        cac_luot.append((thu, cac_mat))
        if cac_mat and (mat_tot is None or cac_mat[0][1] > mat_tot[0]):
            mat_tot = (cac_mat[0][1], thu, cac_mat[0][0])
        for hop, diem in cac_mat:
            kq = tim_khung_theo_phong(thu, hop)
            if kq is not None:
                if khung_tot is None or diem > khung_tot[0]:
                    khung_tot = (diem, thu, kq[0], hop, kq[1])
                break
        # hình đang đúng chiều và mặt rõ -> khỏi thử các chiều xoay khác
        if ma is None and khung_tot and khung_tot[0] >= 9:
            break
    if khung_tot and khung_tot[4] >= PHONG_CO_MAU:
        _, nen, goc, hop, _ = khung_tot
        return hoan_tat(nen, goc, goc_cua_hop(hop))

    # --- B. Tờ ảnh nằm gọn trên nền trơn: dò theo mép tờ giấy, rồi xác nhận bằng khuôn mặt
    #        bên trong. Dùng cho phông trắng / xám, ảnh đặt nghiêng nhiều hoặc nằm ngang.
    cac_to = tim_to_anh(anh)[:4]
    for goc_to in cac_to:
        to_tho, M_to = nan_thang(anh, goc_to)
        to, mat, ma = xoay_tam_anh(to_tho)
        if mat is None or not (0.22 <= mat[2] / to.shape[1] <= MAT_RONG_MAX):
            continue  # không có khuôn mặt cỡ hợp lý -> không phải tờ ảnh thẻ
        # trong tờ ảnh: phông có màu thì lấy mép phông cho chính xác, không thì tự bỏ viền giấy
        kq = tim_khung_theo_phong(to, mat)
        if kq and kq[1] >= PHONG_CO_MAU:
            goc_trong = kq[0]
        else:
            # Tờ ảnh có khung viền in sẵn (đường kẻ đen) thì lấy phần hình bên trong khung.
            # Khung viền luôn nằm sát mép giấy: chỉ nhận khi cả ba mép nằm bên trong tờ ảnh
            # nhưng cách mép giấy không quá 12%. Xa hơn thế là bắt nhầm (mép tóc, mép áo).
            kq = tim_khung_theo_mep(to, mat)
            tw, th = to.shape[1], to.shape[0]
            goc_trong = None
            if kq:
                trai, phai, tren = kq[0][0, 0], kq[0][1, 0], min(kq[0][0, 1], kq[0][1, 1])
                if 0.015 * tw < trai < 0.12 * tw and 0.88 * tw < phai < 0.985 * tw and 0.015 * tw < tren < 0.12 * th:
                    goc_trong = kq[0]
            if goc_trong is None:
                goc_trong = khung_trong_to(to, mat)
        co = to_tho.shape[:2]
        return hoan_tat(anh, ve_anh_goc(goc_trong, M_to, ma, co), ve_anh_goc(goc_cua_hop(mat), M_to, ma, co))

    # --- A2. Phông nhạt màu, ảnh dán trên hồ sơ (xung quanh có chữ, dấu): dò các đường thẳng
    #         dài quanh từng khuôn mặt ứng viên. Mặt được chấm điểm cao nhất có khi là mặt dò
    #         nhầm trên con dấu / chữ viết, nên chọn theo độ rõ của ba mép chứ không theo điểm mặt.
    for thu, cac_mat in cac_luot:
        tot_mep = None
        for hop, _ in cac_mat:
            kq = tim_khung_theo_mep(thu, hop)
            if kq and (tot_mep is None or kq[1] > tot_mep[0]):
                tot_mep = (kq[1], kq[0], hop)
        if tot_mep:
            return hoan_tat(thu, tot_mep[1], goc_cua_hop(tot_mep[2]))

    # Phông nhạt màu mà không thấy cả mép tờ giấy lẫn đường thẳng nào quanh mặt.
    if khung_tot:
        _, nen, goc, hop, _ = khung_tot
        return hoan_tat(nen, goc, goc_cua_hop(hop), "phông nền nhạt màu, mép ảnh có thể chưa chuẩn")

    # Thấy tờ ảnh nhưng không dò ra khuôn mặt nào (mặt bị che, ảnh quá mờ...): vẫn cắt theo
    # tờ ảnh lớn nhất, giữ nguyên chiều đang có, và báo để người dùng xem lại.
    if cac_to and mat_tot is None:
        to, M_to = nan_thang(anh, cac_to[0])
        if to.shape[0] > to.shape[1]:
            gia = (to.shape[1] // 4, 0, to.shape[1] // 2, 0)  # coi như mặt nằm chính giữa
            goc = ve_anh_goc(khung_trong_to(to, gia), M_to, None, to.shape[:2])
            return hoan_tat(anh, goc, np.zeros((4, 2), np.float32), "không thấy khuôn mặt, nên kiểm tra lại")

    # --- C. Chỉ có khuôn mặt.
    if mat_tot:
        _, nen, hop = mat_tot
        cat, goc = cat_theo_mat(nen, hop)
        (x0, y0), (x1, y1) = goc[0], goc[2]
        mat_ti_le = ((hop[0] - x0) / (x1 - x0), (hop[1] - y0) / (y1 - y0), (hop[0] + hop[2] - x0) / (x1 - x0), (hop[1] + hop[3] - y0) / (y1 - y0))
        ra = hoan_thien(cat, kich_thuoc, muc, None, mat_ti_le)
        return KetQua(ra, nen, goc, "không tìm được mép ảnh thẻ, cắt ước lượng quanh khuôn mặt")
    return None


def ve_debug(anh: np.ndarray, goc: np.ndarray | None, vong_dau: list[tuple[float, float, float]] | None = None) -> np.ndarray:
    ra = anh.copy()
    day = max(2, max(anh.shape[:2]) // 400)
    if goc is not None:
        cv2.polylines(ra, [np.round(goc).astype(np.int32)], True, (0, 0, 255), day)
    for cx, cy, r in vong_dau or []:  # con dấu: vòng xanh lá
        cv2.circle(ra, (int(round(cx)), int(round(cy))), int(round(r)), (0, 200, 0), day)
    k = 1000 / max(ra.shape[:2])
    return cv2.resize(ra, None, fx=k, fy=k, interpolation=cv2.INTER_AREA) if k < 1 else ra


# ---------------------------------------------------------------- dòng lệnh

def phan_tich_kich_thuoc(s: str) -> tuple[int, int]:
    try:
        rong, cao = (int(v) for v in s.lower().split("x"))
    except ValueError:
        raise argparse.ArgumentTypeError("kích thước phải có dạng RỘNGxCAO, ví dụ 354x472")
    if rong <= 0 or cao <= 0 or abs(rong / cao - TI_LE) > 0.01:
        raise argparse.ArgumentTypeError("kích thước phải đúng tỉ lệ 3:4, ví dụ 354x472 hoặc 600x800")
    return rong, cao


DONG_GOI = bool(getattr(sys, "frozen", False))  # đang chạy từ file .exe đã đóng gói


def main() -> int:
    # Bản .exe: thư mục input / output nằm cạnh file .exe (không phải thư mục giải nén tạm).
    goc_tool = Path(sys.executable).resolve().parent if DONG_GOI else Path(__file__).resolve().parent
    p = argparse.ArgumentParser(description="Cắt ảnh thẻ 3x4 tự động từ ảnh chụp lại tấm ảnh thẻ.")
    p.add_argument("nguon", nargs="?", default=str(goc_tool / "input"), help="file ảnh hoặc thư mục ảnh (mặc định: ./input)")
    p.add_argument("-o", "--out", default=str(goc_tool / "output"), help="thư mục xuất (mặc định: ./output)")
    p.add_argument("--size", type=phan_tich_kich_thuoc, default=(354, 472), help="kích thước px, mặc định 354x472 (3x4cm @300DPI)")
    p.add_argument("--dpi", type=int, default=300)
    p.add_argument("--png", action="store_true", help="xuất PNG thay vì JPG")
    p.add_argument("--bo-vien", type=float, default=0.012, help="tỉ lệ mép cắt bỏ thêm để hết viền trắng (mặc định 0.012)")
    p.add_argument(
        "--muc", type=int, choices=(0, 1, 2, 3), default=2,
        help="mức chỉnh đẹp (cân màu, làm sáng, khử nhiễu, tăng nét): 0 = giữ nguyên, 1 = nhẹ, 2 = vừa (mặc định), 3 = mạnh",
    )
    p.add_argument("--khong-tang-cuong", action="store_true", help="giống --muc 0")
    p.add_argument("--giu-dau", action="store_true", help="không xóa dấu đỏ đóng đè lên ảnh thẻ")
    p.add_argument("--debug", action="store_true", help="lưu ảnh khoanh vùng cắt vào <out>/_debug")
    a = p.parse_args()
    if DONG_GOI:
        a.debug = True  # bản .exe thường được bấm đúp, luôn lưu ảnh khoanh vùng để dễ soát
        (goc_tool / "input").mkdir(exist_ok=True)

    nguon, out = Path(a.nguon), Path(a.out)
    if nguon.is_file():
        ds = [nguon]
    elif nguon.is_dir():
        ds = sorted(f for f in nguon.iterdir() if f.suffix.lower() in DUOI_ANH)
    else:
        print(f"Không tìm thấy: {nguon}")
        return 2
    if not ds:
        print(f"Không có ảnh nào trong {nguon}")
        return 2

    duoi = ".png" if a.png else ".jpg"
    can_xem, loi = [], []
    for i, f in enumerate(ds, 1):
        anh = doc_anh(f)
        if anh is None:
            loi.append((f.name, "không đọc được file"))
            print(f"[{i}/{len(ds)}] LỖI   {f.name}: không đọc được file")
            continue
        kq = xu_ly(anh, a.size, a.bo_vien, 0 if a.khong_tang_cuong else a.muc, not a.giu_dau)
        if kq is None:
            loi.append((f.name, "không tìm được tấm ảnh lẫn khuôn mặt"))
            print(f"[{i}/{len(ds)}] LỖI   {f.name}: không tìm được tấm ảnh lẫn khuôn mặt")
            continue
        luu_anh(kq.anh, out / f"{f.stem}_3x4{duoi}", a.dpi)
        if a.debug:
            luu_anh(ve_debug(kq.nen, kq.goc, kq.vong_dau), out / "_debug" / f"{f.stem}_debug.jpg", 72, 85)
        if kq.ghi_chu:
            can_xem.append((f.name, kq.ghi_chu))
        loi_nhan = kq.ghi_chu or ("đã xóa dấu đỏ" if kq.da_xoa_dau else "")
        print(f"[{i}/{len(ds)}] {'OK   ' if not kq.ghi_chu else 'XEM  '} {f.name}" + (f": {loi_nhan}" if loi_nhan else ""))

    print(f"\nXong: {len(ds) - len(loi)}/{len(ds)} ảnh -> {out}")
    if can_xem:
        print(f"Nên kiểm tra lại {len(can_xem)} ảnh: " + ", ".join(n for n, _ in can_xem))
    if loi:
        print(f"Lỗi {len(loi)} ảnh: " + ", ".join(n for n, _ in loi))
    return 1 if loi else 0


if __name__ == "__main__":
    try:
        if sys.platform == "win32":  # để cửa sổ lệnh hiện đúng tiếng Việt
            import ctypes

            ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ma = main()
    if DONG_GOI and sys.stdin is not None and sys.stdin.isatty():
        try:  # bấm đúp file .exe thì giữ cửa sổ lại để đọc kết quả
            input("\nNhấn Enter để đóng...")
        except EOFError:
            pass
    sys.exit(ma)
