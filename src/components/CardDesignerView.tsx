import React, { useState } from 'react';
import {
  Palette,
  Type,
  Sliders,
  Save,
  Plus,
  Trash2,
  CheckCircle2,
  Upload,
  Eye,
  RotateCcw,
} from 'lucide-react';
import {
  CardTemplate,
  Employee,
  DEFAULT_CARD_TEMPLATES,
  OFFICIAL_VIETSUN_LOGO,
} from '../types';
import { IdCardPreview } from './IdCardPreview';

interface CardDesignerViewProps {
  templates: CardTemplate[];
  selectedTemplate: CardTemplate;
  onSelectTemplate: (template: CardTemplate) => void;
  onSaveTemplate: (template: CardTemplate, asNew: boolean) => Promise<void>;
  onDeleteTemplate: (templateId: string) => Promise<void>;
  employees: Employee[];
}

export const CardDesignerView: React.FC<CardDesignerViewProps> = ({
  templates,
  selectedTemplate,
  onSelectTemplate,
  onSaveTemplate,
  onDeleteTemplate,
  employees,
}) => {
  const [draft, setDraft] = useState<CardTemplate>(selectedTemplate);
  const [previewEmployeeId, setPreviewEmployeeId] = useState<string>(
    employees[0]?.id || ''
  );
  const [previewScale, setPreviewScale] = useState<number>(1.6);
  const [activeSubTab, setActiveSubTab] = useState<
    'layout' | 'typography' | 'position'
  >('layout');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const handlePickTemplate = (tpl: CardTemplate) => {
    onSelectTemplate(tpl);
    setDraft(tpl);
    setSaveMessage(null);
  };

  const previewEmployee: Employee =
    employees.find((e) => e.id === previewEmployeeId) ||
    employees[0] || {
      id: 'sample',
      msnv: '90993',
      fullName: 'TRƯƠNG MINH HIẾU',
      department: 'Bảo trì vận hành',
      joinDate: '02/10/2026',
      photoUrl: '',
      printCount: 1,
      lastPrintedAt: '11/11/2026',
      ownerId: '',
    };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 240;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/png', 0.85);
        setDraft((prev) => ({ ...prev, logoUrl: dataUrl }));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (asNew: boolean) => {
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const toSave: CardTemplate = asNew
        ? {
            ...draft,
            showStamp: false,
            showQrOnBack: false,
            name: `${draft.name} (Bản sao)`,
            isDefault: false,
          }
        : {
            ...draft,
            showStamp: false,
            showQrOnBack: false,
          };
      await onSaveTemplate(toSave, asNew);
      setSaveMessage(
        asNew
          ? 'Đã lưu thành mẫu thiết kế mới!'
          : 'Đã cập nhật mẫu thiết kế thành công!'
      );
      setTimeout(() => setSaveMessage(null), 4000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToVietSunStandard = () => {
    const std = DEFAULT_CARD_TEMPLATES[0];
    setDraft((prev) => ({
      ...prev,
      ...std,
      id: prev.id,
      ownerId: prev.ownerId,
      name: prev.name,
    }));
  };

  const isPortrait = draft.orientation === 'portrait';
  const baseWidthMm = isPortrait ? 54 : 85.6;
  const baseHeightMm = isPortrait ? 85.6 : 54;

  return (
    <div className="space-y-6">
      {/* Top Bar: Template Selector & Save Actions */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              Chọn mẫu thẻ đã lưu ({templates.length} mẫu)
            </label>
            <select
              value={draft.id}
              onChange={(e) => {
                const found = templates.find((t) => t.id === e.target.value);
                if (found) handlePickTemplate(found);
              }}
              className="px-3 py-2 text-sm font-semibold text-slate-900 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.isDefault ? '(Mặc định)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              Tên mẫu thiết kế
            </label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="px-3 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg w-64 focus:outline-none focus:border-blue-600"
              placeholder="Nhập tên mẫu thẻ..."
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {saveMessage && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
              <CheckCircle2 className="w-4 h-4" />
              {saveMessage}
            </span>
          )}

          <button
            type="button"
            onClick={handleResetToVietSunStandard}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer transition-colors"
            title="Khôi phục thông số chuẩn thẻ VIETSUN ĐỒNG NAI"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Chuẩn VietSun Đồng Nai
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={() => handleSave(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg cursor-pointer transition-colors"
          >
            <Plus className="w-4 h-4" />
            Lưu Thành Mẫu Mới
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={() => handleSave(false)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer transition-colors"
          >
            <Save className="w-4 h-4" />
            {isSaving ? 'Đang lưu...' : 'Lưu Cập Nhật Mẫu'}
          </button>

          {templates.length > 1 && (
            <button
              type="button"
              onClick={() => onDeleteTemplate(draft.id)}
              className="p-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg cursor-pointer transition-colors"
              title="Xóa mẫu thẻ này"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Split Workspace: Left Controls + Right Live Physical Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Customization Panel (5 cols) */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          {/* Sub-navigation tabs (3 tabs: Layout/Color, Font/Size, Position) */}
          <div className="grid grid-cols-3 border-b border-slate-200 bg-slate-50 p-1 gap-1">
            <button
              type="button"
              onClick={() => setActiveSubTab('layout')}
              className={`flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-semibold rounded-lg cursor-pointer transition-colors ${
                activeSubTab === 'layout'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              Bố cục & Màu
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('typography')}
              className={`flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-semibold rounded-lg cursor-pointer transition-colors ${
                activeSubTab === 'typography'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Type className="w-3.5 h-3.5" />
              Font & Cỡ chữ
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('position')}
              className={`flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-semibold rounded-lg cursor-pointer transition-colors ${
                activeSubTab === 'position'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              Căn chỉnh vị trí
            </button>
          </div>

          <div className="p-5 space-y-4">
            {/* SUBTAB 1: LAYOUT & COLORS & COMPANY HEADER */}
            {activeSubTab === 'layout' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Kiểu bố cục thẻ
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    <label className="flex items-center gap-2.5 p-2.5 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 text-xs">
                      <input
                        type="radio"
                        checked={true}
                        onChange={() =>
                          setDraft({
                            ...draft,
                            layoutStyle: 'vietsun_table',
                            orientation: 'landscape',
                            fontFamily: "'Noto Serif', 'Times New Roman', serif",
                          })
                        }
                      />
                      <div>
                        <span className="font-bold text-slate-900 block">
                          Khung bảng chuẩn VIETSUN ĐỒNG NAI (Ngang CR80)
                        </span>
                        <span className="text-slate-500">
                          Viền đôi sắc nét, logo VIETSUN bên trái, ảnh 3×4 và 4 dòng kẻ ngang
                        </span>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Company Header Text */}
                <div className="pt-2 border-t border-slate-200 space-y-2.5">
                  <div className="text-xs font-bold text-slate-800">
                    Thông tin Tiêu đề Công ty & Logo trên thẻ
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Dòng tiêu đề 1 (Chi nhánh / Đơn vị)
                    </label>
                    <input
                      type="text"
                      value={draft.companyBranch}
                      onChange={(e) =>
                        setDraft({ ...draft, companyBranch: e.target.value })
                      }
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Dòng tiêu đề 2
                    </label>
                    <input
                      type="text"
                      value={draft.companyNameLine1}
                      onChange={(e) =>
                        setDraft({ ...draft, companyNameLine1: e.target.value })
                      }
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Dòng tiêu đề 3
                    </label>
                    <input
                      type="text"
                      value={draft.companyNameLine2}
                      onChange={(e) =>
                        setDraft({ ...draft, companyNameLine2: e.target.value })
                      }
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg cursor-pointer hover:bg-blue-100">
                      <Upload className="w-3.5 h-3.5" />
                      Đổi ảnh Logo khác
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoUpload}
                        className="hidden"
                      />
                    </label>
                    {draft.logoUrl !== OFFICIAL_VIETSUN_LOGO && (
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            logoUrl: OFFICIAL_VIETSUN_LOGO,
                          })
                        }
                        className="text-xs text-blue-700 font-semibold hover:underline cursor-pointer"
                      >
                        Dùng lại Logo chuẩn VIETSUN
                      </button>
                    )}
                  </div>
                </div>

                {/* Color Pickers */}
                <div className="pt-2 border-t border-slate-200">
                  <div className="text-xs font-bold text-slate-800 mb-2">
                    Tùy chỉnh Màu sắc trên thẻ
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <label className="flex items-center justify-between border border-slate-200 p-2 rounded-lg">
                      <span className="text-slate-700">Màu chữ chính</span>
                      <input
                        type="color"
                        value={draft.textColor}
                        onChange={(e) =>
                          setDraft({ ...draft, textColor: e.target.value })
                        }
                        className="w-7 h-7 rounded cursor-pointer border-0"
                      />
                    </label>
                    <label className="flex items-center justify-between border border-slate-200 p-2 rounded-lg">
                      <span className="text-slate-700">Màu khung kẻ bảng</span>
                      <input
                        type="color"
                        value={draft.borderColor}
                        onChange={(e) =>
                          setDraft({ ...draft, borderColor: e.target.value })
                        }
                        className="w-7 h-7 rounded cursor-pointer border-0"
                      />
                    </label>
                    <label className="flex items-center justify-between border border-slate-200 p-2 rounded-lg">
                      <span className="text-slate-700">Màu nền thẻ</span>
                      <input
                        type="color"
                        value={draft.backgroundColor}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            backgroundColor: e.target.value,
                          })
                        }
                        className="w-7 h-7 rounded cursor-pointer border-0"
                      />
                    </label>
                    <label className="flex items-center justify-between border border-slate-200 p-2 rounded-lg">
                      <span className="text-slate-700">Màu nền ảnh 3×4</span>
                      <input
                        type="color"
                        value={draft.photoBgColor}
                        onChange={(e) =>
                          setDraft({ ...draft, photoBgColor: e.target.value })
                        }
                        className="w-7 h-7 rounded cursor-pointer border-0"
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* SUBTAB 2: TYPOGRAPHY & FONT SIZES */}
            {activeSubTab === 'typography' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Font chữ hiển thị trên thẻ
                  </label>
                  <select
                    value={draft.fontFamily}
                    onChange={(e) =>
                      setDraft({ ...draft, fontFamily: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="'Noto Serif', 'Times New Roman', serif">
                      Noto Serif / Times New Roman (Chuẩn thẻ truyền thống VietSun)
                    </option>
                    <option value="'Plus Jakarta Sans', sans-serif">
                      Plus Jakarta Sans (Hiện đại, sắc nét)
                    </option>
                    <option value="Arial, Helvetica, sans-serif">
                      Arial / Helvetica (Cổ điển, dễ đọc)
                    </option>
                    <option value="'IBM Plex Mono', monospace">
                      IBM Plex Mono (Kỹ thuật công nghiệp)
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tiền tố trước tên Bộ phận (ví dụ: &quot;BP. &quot;)
                  </label>
                  <input
                    type="text"
                    value={draft.deptPrefix}
                    onChange={(e) =>
                      setDraft({ ...draft, deptPrefix: e.target.value })
                    }
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                    placeholder="BP. "
                  />
                </div>

                <div className="space-y-3 pt-2 border-t border-slate-200">
                  <div className="text-xs font-bold text-slate-800">
                    Kích thước chữ từng trường thông tin (px)
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-600">Cỡ chữ Họ và tên</span>
                      <span className="font-mono-num font-semibold">
                        {draft.nameFontSize}px
                      </span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="18"
                      step="0.5"
                      value={draft.nameFontSize}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          nameFontSize: Number(e.target.value),
                        })
                      }
                      className="w-full accent-blue-600"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-600">
                        Cỡ chữ Mã số nhân viên (MSNV)
                      </span>
                      <span className="font-mono-num font-semibold">
                        {draft.msnvFontSize}px
                      </span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="18"
                      step="0.5"
                      value={draft.msnvFontSize}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          msnvFontSize: Number(e.target.value),
                        })
                      }
                      className="w-full accent-blue-600"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-600">Cỡ chữ Bộ phận</span>
                      <span className="font-mono-num font-semibold">
                        {draft.deptFontSize}px
                      </span>
                    </div>
                    <input
                      type="range"
                      min="9"
                      max="16"
                      step="0.5"
                      value={draft.deptFontSize}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          deptFontSize: Number(e.target.value),
                        })
                      }
                      className="w-full accent-blue-600"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-600">Cỡ chữ Ngày vào làm</span>
                      <span className="font-mono-num font-semibold">
                        {draft.dateFontSize}px
                      </span>
                    </div>
                    <input
                      type="range"
                      min="9"
                      max="16"
                      step="0.5"
                      value={draft.dateFontSize}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          dateFontSize: Number(e.target.value),
                        })
                      }
                      className="w-full accent-blue-600"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-600">
                        Cỡ chữ Tiêu đề công ty
                      </span>
                      <span className="font-mono-num font-semibold">
                        {draft.headerFontSize}px
                      </span>
                    </div>
                    <input
                      type="range"
                      min="6.5"
                      max="11"
                      step="0.5"
                      value={draft.headerFontSize}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          headerFontSize: Number(e.target.value),
                        })
                      }
                      className="w-full accent-blue-600"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* SUBTAB 3: POSITIONING */}
            {activeSubTab === 'position' && (
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-semibold text-slate-700">
                      Độ rộng khung ảnh chân dung 25×35mm (%)
                    </span>
                    <span className="font-mono-num font-semibold">
                      {draft.photoWidthPercent}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="18"
                    max="38"
                    step="0.5"
                    value={draft.photoWidthPercent}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        photoWidthPercent: Number(e.target.value),
                      })
                    }
                    className="w-full accent-blue-600"
                  />
                </div>

                <div className="pt-2 border-t border-slate-200 space-y-2.5">
                  <div className="text-xs font-bold text-slate-800">
                    Tinh chỉnh vị trí dọc (Offset Y) từng dòng thông tin
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="block text-slate-600 mb-1">
                        Vị trí Họ tên ({draft.nameOffsetY}px)
                      </span>
                      <input
                        type="range"
                        min="-8"
                        max="8"
                        step="1"
                        value={draft.nameOffsetY}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            nameOffsetY: Number(e.target.value),
                          })
                        }
                        className="w-full accent-blue-600"
                      />
                    </div>
                    <div>
                      <span className="block text-slate-600 mb-1">
                        Vị trí MSNV ({draft.msnvOffsetY}px)
                      </span>
                      <input
                        type="range"
                        min="-8"
                        max="8"
                        step="1"
                        value={draft.msnvOffsetY}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            msnvOffsetY: Number(e.target.value),
                          })
                        }
                        className="w-full accent-blue-600"
                      />
                    </div>
                    <div>
                      <span className="block text-slate-600 mb-1">
                        Vị trí Bộ phận ({draft.deptOffsetY}px)
                      </span>
                      <input
                        type="range"
                        min="-8"
                        max="8"
                        step="1"
                        value={draft.deptOffsetY}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            deptOffsetY: Number(e.target.value),
                          })
                        }
                        className="w-full accent-blue-600"
                      />
                    </div>
                    <div>
                      <span className="block text-slate-600 mb-1">
                        Vị trí Ngày vào làm ({draft.dateOffsetY}px)
                      </span>
                      <input
                        type="range"
                        min="-8"
                        max="8"
                        step="1"
                        value={draft.dateOffsetY}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            dateOffsetY: Number(e.target.value),
                          })
                        }
                        className="w-full accent-blue-600"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Live Preview Canvas (7 cols) */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          {/* Preview Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-bold text-slate-900">
                Xem Trước Thẻ Theo Kích Thước Thực Tế (CR80: 85.6mm × 54mm)
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-500">Dữ liệu NV:</span>
                <select
                  value={previewEmployee.id}
                  onChange={(e) => setPreviewEmployeeId(e.target.value)}
                  className="px-2.5 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg bg-slate-50"
                >
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.msnv} - {emp.fullName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setPreviewScale(1)}
                  className={`px-2 py-1 rounded font-mono-num cursor-pointer ${
                    previewScale === 1
                      ? 'bg-white text-blue-700 font-bold shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  100% (1:1)
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewScale(1.6)}
                  className={`px-2 py-1 rounded font-mono-num cursor-pointer ${
                    previewScale === 1.6
                      ? 'bg-white text-blue-700 font-bold shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  160%
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewScale(2)}
                  className={`px-2 py-1 rounded font-mono-num cursor-pointer ${
                    previewScale === 2
                      ? 'bg-white text-blue-700 font-bold shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  200%
                </button>
              </div>
            </div>
          </div>

          {/* Single Front Card Preview */}
          <div className="bg-slate-100 border border-slate-200 rounded-xl p-8 flex flex-col items-center justify-center min-h-[340px] overflow-x-auto">
            <div className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span>Thẻ Nhân Viên Chuẩn In</span>
              <span className="text-slate-400 font-mono-num">
                · {baseWidthMm}mm × {baseHeightMm}mm
              </span>
            </div>
            <div
              style={{
                width: `${baseWidthMm * previewScale}mm`,
                height: `${baseHeightMm * previewScale}mm`,
              }}
              className="shadow-lg rounded-sm bg-white"
            >
              <IdCardPreview
                employee={previewEmployee}
                template={draft}
                scale={previewScale}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
