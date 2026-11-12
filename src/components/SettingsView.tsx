import React, { useState } from 'react';
import {
  Save,
  Building2,
  Printer,
  CheckCircle2,
  Upload,
  BookOpen,
} from 'lucide-react';
import { AppSettings } from '../types';

interface SettingsViewProps {
  settings: AppSettings;
  onSaveSettings: (updated: AppSettings) => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSaveSettings,
}) => {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [isSaving, setIsSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setDraft((prev) => ({ ...prev, logoUrl: String(reader.result) }));
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSavedNotice(false);
    try {
      await onSaveSettings(draft);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 4000);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left: Settings Form (7 cols) */}
      <form
        onSubmit={handleSubmit}
        className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-6"
      >
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Cài Đặt Hệ Thống, Thương Hiệu Công Ty & Cấu Hình In Mặc Định
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Các thông số này được lưu vào cơ sở dữ liệu và áp dụng mặc định khi mở trình in hàng loạt
            </p>
          </div>
          {savedNotice && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
              <CheckCircle2 className="w-4 h-4" />
              Đã lưu cài đặt!
            </span>
          )}
        </div>

        {/* Section 1: Company Branding */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-700">
            <Building2 className="w-4 h-4" />
            1. Thông Tin Công Ty & Logo Mặc Định
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Tên Chi Nhánh / Đơn Vị
              </label>
              <input
                type="text"
                required
                value={draft.companyBranch}
                onChange={(e) =>
                  setDraft({ ...draft, companyBranch: e.target.value })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Tên Công Ty Chủ Quản (Dòng 1)
              </label>
              <input
                type="text"
                required
                value={draft.companyName}
                onChange={(e) =>
                  setDraft({ ...draft, companyName: e.target.value })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="text-xs">
            <label className="block font-semibold text-slate-700 mb-1">
              Tên Công Ty (Dòng 2)
            </label>
            <input
              type="text"
              value={draft.companySubName}
              onChange={(e) =>
                setDraft({ ...draft, companySubName: e.target.value })
              }
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>

          <div className="flex items-center gap-4 pt-1 text-xs">
            <label className="inline-flex items-center gap-1.5 px-3.5 py-2 font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 cursor-pointer">
              <Upload className="w-4 h-4" />
              Tải lên Logo công ty
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="hidden"
              />
            </label>
            {draft.logoUrl && (
              <button
                type="button"
                onClick={() => setDraft({ ...draft, logoUrl: '' })}
                className="text-red-600 hover:underline cursor-pointer"
              >
                Xóa logo tải lên (dùng logo chuẩn VIETSUN)
              </button>
            )}
          </div>
        </div>

        {/* Section 2: Default Print Parameters */}
        <div className="space-y-4 pt-4 border-t border-slate-200">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-700">
            <Printer className="w-4 h-4" />
            2. Kích Thước Thẻ & Cấu Hình Trang In Mặc Định
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Khổ giấy in mặc định
              </label>
              <select
                value={draft.defaultPaperSize}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    defaultPaperSize: e.target.value as 'A4' | 'CR80' | 'Letter',
                  })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                <option value="A4">Giấy A4 (In nhiều thẻ rồi cắt)</option>
                <option value="CR80">Máy in thẻ nhựa CR80 (85.6×54mm)</option>
                <option value="Letter">Giấy Letter</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Chiều rộng thẻ (mm) — Chuẩn CR80: 85.6
              </label>
              <input
                type="number"
                step="0.1"
                value={draft.cardWidthMm}
                onChange={(e) =>
                  setDraft({ ...draft, cardWidthMm: Number(e.target.value) })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono-num"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Chiều cao thẻ (mm) — Chuẩn CR80: 54
              </label>
              <input
                type="number"
                step="0.1"
                value={draft.cardHeightMm}
                onChange={(e) =>
                  setDraft({ ...draft, cardHeightMm: Number(e.target.value) })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono-num"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Số cột trên giấy A4
              </label>
              <input
                type="number"
                min={1}
                max={4}
                value={draft.defaultCols}
                onChange={(e) =>
                  setDraft({ ...draft, defaultCols: Number(e.target.value) })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono-num"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Số hàng trên giấy A4
              </label>
              <input
                type="number"
                min={1}
                max={6}
                value={draft.defaultRows}
                onChange={(e) =>
                  setDraft({ ...draft, defaultRows: Number(e.target.value) })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono-num"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Khoảng cách thẻ (mm)
              </label>
              <input
                type="number"
                min={0}
                max={20}
                value={draft.defaultGapMm}
                onChange={(e) =>
                  setDraft({ ...draft, defaultGapMm: Number(e.target.value) })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono-num"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Lề trang giấy (mm)
              </label>
              <input
                type="number"
                min={0}
                max={30}
                value={draft.defaultMarginMm}
                onChange={(e) =>
                  setDraft({ ...draft, defaultMarginMm: Number(e.target.value) })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono-num"
              />
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-200 flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
          >
            <Save className="w-4 h-4" />
            {isSaving ? 'Đang lưu...' : 'Lưu Cấu Hình Hệ Thống'}
          </button>
        </div>
      </form>

      {/* Right: Practical Printing & Deployment Guide (5 cols) */}
      <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900 border-b border-slate-200 pb-3">
          <BookOpen className="w-4 h-4 text-blue-700" />
          Hướng Dẫn In Đúng Kích Thước Thực Tế & Vận Hành
        </div>

        <div className="space-y-3 text-xs text-slate-600 leading-relaxed">
          <div className="p-3.5 bg-blue-50/60 border border-blue-100 rounded-lg">
            <div className="font-bold text-blue-900 mb-1">
              1. Quy trình 1: Thêm hàng loạt nhân viên bằng Excel
            </div>
            <p>
              Vào mục <strong>Quản lý nhân viên</strong> → Bấm <strong>Tải File Excel Mẫu</strong> → Điền danh sách gồm 4 cột (<em>MSNV, Họ và tên, Bộ phận, Ngày vào làm</em>) → Bấm <strong>IMPORT EXCEL</strong> → Kiểm tra bảng xem trước (các dòng thiếu thông tin hoặc trùng MSNV sẽ được cảnh báo đỏ rõ ràng) → Bấm <strong>Xác nhận Import</strong>.
            </p>
          </div>

          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="font-bold text-slate-900 mb-1">
              2. Quy trình 2: In hàng loạt trên giấy A4 hoặc Máy in thẻ nhựa
            </div>
            <p>
              Chọn nhân viên trong bảng hoặc vào mục <strong>In thẻ</strong> → Chọn số lượng tùy ý (1, 10, 50 hoặc In tất cả) → Chọn chế độ <strong>Giấy A4 (2 cột × 4 hàng = 8 thẻ/trang)</strong> hoặc <strong>Máy in thẻ nhựa CR80 (85.6mm × 54mm)</strong> → Bấm <strong>In Trực Tiếp Ngay</strong> hoặc <strong>Xuất File PDF</strong>.
            </p>
          </div>

          <div className="p-3.5 bg-emerald-50/60 border border-emerald-200 rounded-lg">
            <div className="font-bold text-emerald-900 mb-1">
              3. Mẹo thiết lập hộp thoại máy in (Print Dialog) chuẩn 100% kích thước
            </div>
            <ul className="list-disc pl-4 space-y-1 text-emerald-950">
              <li>
                Trong cửa sổ in của trình duyệt, mục <strong>Tỷ lệ (Scale)</strong>: Chọn <strong>Mặc định (Default / 100% / Actual Size)</strong> — không chọn &quot;Fit to page&quot;.
              </li>
              <li>
                Mục <strong>Lề (Margins)</strong>: Chọn <strong>Không có (None)</strong>.
              </li>
              <li>
                Tích chọn <strong>Đồ họa nền (Background graphics)</strong> để in đầy đủ màu nền ảnh 3×4 và con dấu đỏ.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
