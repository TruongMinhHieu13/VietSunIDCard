import React, { useState, useEffect } from 'react';
import {
  Save,
  Building2,
  Printer,
  CheckCircle2,
  Upload,
  BookOpen,
  Globe,
  Copy,
  Check,
  Play,
  Code2,
  RefreshCw,
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

  // API Integration Panel State
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [testEndpoint, setTestEndpoint] = useState<string>(
    '/api/employees?limit=5&includePhoto=false'
  );
  const [isTestingApi, setIsTestingApi] = useState(false);
  const [apiTestResult, setApiTestResult] = useState<string | null>(null);
  const [codeTab, setCodeTab] = useState<'js' | 'react' | 'php' | 'curl'>('js');

  const baseUrl =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://ais-pre-qhfksv7iqi7bh3lwviassq-668425665932.asia-east1.run.app';

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2200);
  };

  const handleRunApiTest = async (endpointToRun?: string) => {
    const target = endpointToRun || testEndpoint;
    if (endpointToRun) {
      setTestEndpoint(endpointToRun);
    }
    setIsTestingApi(true);
    try {
      const res = await fetch(target);
      const json = await res.json();
      setApiTestResult(JSON.stringify(json, null, 2));
    } catch (err) {
      setApiTestResult(
        JSON.stringify(
          {
            success: false,
            error:
              err instanceof Error ? err.message : 'Lỗi kết nối khi gọi API',
          },
          null,
          2
        )
      );
    } finally {
      setIsTestingApi(false);
    }
  };

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

  const codeSnippets: Record<'js' | 'react' | 'php' | 'curl', string> = {
    js: `// Gọi API lấy danh sách nhân viên từ website khác (Đã bật sẵn CORS *)
async function loadVietSunEmployees() {
  const response = await fetch('${baseUrl}/api/employees?includePhoto=false');
  const result = await response.json();

  if (result.success) {
    console.log('Tổng số nhân viên:', result.total);
    console.log('Danh sách nhân viên:', result.data);
    return result.data;
  }
}`,
    react: `// Hook lấy danh sách nhân viên trong React / Next.js
import { useEffect, useState } from 'react';

export function useVietSunEmployees(department = '') {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = new URL('${baseUrl}/api/employees');
    if (department) url.searchParams.set('department', department);
    url.searchParams.set('includePhoto', 'false');

    fetch(url.toString())
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setEmployees(json.data);
      })
      .finally(() => setLoading(false));
  }, [department]);

  return { employees, loading };
}`,
    php: `<?php
// Tích hợp lấy danh sách nhân viên trong PHP / WordPress / Laravel
$apiUrl = "${baseUrl}/api/employees?includePhoto=false";
$response = file_get_contents($apiUrl);
$result = json_decode($response, true);

if ($result && $result['success']) {
    echo "Tổng số nhân viên: " . $result['total'] . "\\n";
    foreach ($result['data'] as $emp) {
        echo $emp['msnv'] . " - " . $emp['fullName'] . " (" . $emp['department'] . ")\\n";
    }
}
?>`,
    curl: `# 1. Lấy toàn bộ danh sách nhân viên (bỏ ảnh base64 để tải siêu nhanh)
curl -X GET "${baseUrl}/api/employees?includePhoto=false"

# 2. Tìm kiếm hoặc lọc theo bộ phận & phân trang
curl -X GET "${baseUrl}/api/employees?department=BGĐ&page=1&limit=50"

# 3. Tra cứu chi tiết 1 nhân viên theo MSNV
curl -X GET "${baseUrl}/api/employees/90993"

# 4. Lấy danh sách bộ phận kèm số lượng nhân viên
curl -X GET "${baseUrl}/api/departments"`,
  };

  return (
    <div className="space-y-6">
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
                      defaultPaperSize: e.target.value as
                        | 'A4'
                        | 'CR80'
                        | 'Letter',
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
                    setDraft({
                      ...draft,
                      defaultMarginMm: Number(e.target.value),
                    })
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
                Vào mục <strong>Quản lý nhân viên</strong> → Bấm{' '}
                <strong>Tải File Excel Mẫu</strong> → Điền danh sách nhân sự →
                Bấm <strong>IMPORT EXCEL</strong> → Kiểm tra bảng xem trước →
                Bấm <strong>Xác nhận Import</strong>.
              </p>
            </div>

            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="font-bold text-slate-900 mb-1">
                2. Quy trình 2: In hàng loạt trên giấy A4 hoặc Máy in thẻ nhựa
              </div>
              <p>
                Chọn nhân viên trong bảng hoặc vào mục <strong>In thẻ</strong> →
                Chọn số lượng tùy ý → Chọn chế độ{' '}
                <strong>Giấy A4 (2 cột × 4 hàng = 8 thẻ/trang)</strong> hoặc{' '}
                <strong>Máy in thẻ nhựa CR80 (85.6mm × 54mm)</strong> → Bấm{' '}
                <strong>In Trực Tiếp Ngay</strong> hoặc{' '}
                <strong>Xuất File PDF</strong>.
              </p>
            </div>

            <div className="p-3.5 bg-emerald-50/60 border border-emerald-200 rounded-lg">
              <div className="font-bold text-emerald-900 mb-1">
                3. Mẹo thiết lập hộp thoại máy in (Print Dialog) chuẩn 100% kích thước
              </div>
              <ul className="list-disc pl-4 space-y-1 text-emerald-950">
                <li>
                  Trong cửa sổ in của trình duyệt, mục{' '}
                  <strong>Tỷ lệ (Scale)</strong>: Chọn{' '}
                  <strong>Mặc định (Default / 100% / Actual Size)</strong> —
                  không chọn &quot;Fit to page&quot;.
                </li>
                <li>
                  Mục <strong>Lề (Margins)</strong>: Chọn{' '}
                  <strong>Không có (None)</strong>.
                </li>
                <li>
                  Tích chọn <strong>Đồ họa nền (Background graphics)</strong> để
                  in đầy đủ màu nền ảnh 3×4 và con dấu đỏ.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* REST API Integration Panel for External Websites */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-blue-700 text-white flex items-center justify-center shrink-0">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Cổng REST API Tích Hợp Danh Sách Nhân Viên Cho Website Khác (Đã bật CORS *)
              </h2>
              <p className="text-xs text-slate-500">
                Sử dụng các đường dẫn API chuẩn JSON dưới đây để lấy danh sách nhân viên, tra cứu theo MSNV hoặc lọc theo bộ phận từ bất kỳ website hay phần mềm nào khác.
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg">
            <span className="w-2 h-2 rounded-full bg-emerald-600" />
            CORS Enabled (Access-Control-Allow-Origin: *)
          </span>
        </div>

        {/* Endpoints List */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
          {[
            {
              key: 'ep-all',
              method: 'GET',
              path: '/api/employees',
              fullUrl: `${baseUrl}/api/employees`,
              desc: 'Lấy toàn bộ danh sách nhân viên (đầy đủ thông tin & ảnh 3×4)',
            },
            {
              key: 'ep-light',
              method: 'GET',
              path: '/api/employees?includePhoto=false',
              fullUrl: `${baseUrl}/api/employees?includePhoto=false`,
              desc: 'Lấy danh sách nhân viên siêu nhẹ (bỏ chuỗi ảnh base64 để tải nhanh)',
            },
            {
              key: 'ep-filter',
              method: 'GET',
              path: '/api/employees?search=...&department=...&page=1&limit=50',
              fullUrl: `${baseUrl}/api/employees?page=1&limit=50&includePhoto=false`,
              desc: 'Tìm kiếm theo tên/MSNV, lọc theo bộ phận và phân trang',
            },
            {
              key: 'ep-single',
              method: 'GET',
              path: '/api/employees/:msnv',
              fullUrl: `${baseUrl}/api/employees/90993`,
              desc: 'Tra cứu chi tiết 1 nhân viên theo MSNV (VD: /api/employees/90993)',
            },
            {
              key: 'ep-depts',
              method: 'GET',
              path: '/api/departments',
              fullUrl: `${baseUrl}/api/departments`,
              desc: 'Lấy danh sách tất cả bộ phận kèm số lượng nhân viên từng bộ phận',
            },
            {
              key: 'ep-health',
              method: 'GET',
              path: '/api/health',
              fullUrl: `${baseUrl}/api/health`,
              desc: 'Kiểm tra trạng thái kết nối API (Health Check)',
            },
          ].map((ep) => (
            <div
              key={ep.key}
              className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 flex flex-col justify-between gap-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-700 text-white rounded shrink-0">
                    {ep.method}
                  </span>
                  <code className="font-mono-num font-bold text-slate-900 truncate">
                    {ep.path}
                  </code>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCopy(ep.fullUrl, ep.key)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded cursor-pointer"
                    title="Copy URL đầy đủ"
                  >
                    {copiedKey === ep.key ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600" />
                        Đã copy
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Copy URL
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleRunApiTest(ep.fullUrl.replace(baseUrl, ''))
                    }
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded cursor-pointer"
                  >
                    <Play className="w-3 h-3" />
                    Test
                  </button>
                </div>
              </div>
              <div className="text-[11px] text-slate-600">{ep.desc}</div>
              <div className="text-[11px] font-mono-num text-blue-700 truncate bg-white px-2 py-1 rounded border border-slate-200">
                {ep.fullUrl}
              </div>
            </div>
          ))}
        </div>

        {/* Query Parameters Table */}
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-800">
            Bảng Tham Số Truy Vấn (Query Parameters) Cho Endpoint{' '}
            <code className="font-mono-num text-blue-700">GET /api/employees</code>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <th className="py-2 px-3 font-bold">Tham số</th>
                  <th className="py-2 px-3 font-bold">Kiểu</th>
                  <th className="py-2 px-3 font-bold">Ví dụ</th>
                  <th className="py-2 px-3 font-bold">Mô tả chi tiết</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                <tr>
                  <td className="py-2 px-3 font-mono-num font-bold text-blue-700">
                    includePhoto
                  </td>
                  <td className="py-2 px-3 text-slate-500">boolean</td>
                  <td className="py-2 px-3 font-mono-num">
                    ?includePhoto=false
                  </td>
                  <td className="py-2 px-3 text-slate-700">
                    Mặc định <code>true</code>. Truyền <code>false</code> nếu
                    website khác chỉ cần lấy thông tin chữ (MSNV, Họ tên, Bộ
                    phận, Ngày vào làm) giúp tốc độ tải nhanh gấp 10 lần.
                  </td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-mono-num font-bold text-blue-700">
                    search / q
                  </td>
                  <td className="py-2 px-3 text-slate-500">string</td>
                  <td className="py-2 px-3 font-mono-num">?search=Hiếu</td>
                  <td className="py-2 px-3 text-slate-700">
                    Tìm kiếm theo Họ tên (hỗ trợ cả có dấu và không dấu) hoặc
                    MSNV.
                  </td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-mono-num font-bold text-blue-700">
                    department
                  </td>
                  <td className="py-2 px-3 text-slate-500">string</td>
                  <td className="py-2 px-3 font-mono-num">
                    ?department=Bảo trì
                  </td>
                  <td className="py-2 px-3 text-slate-700">
                    Lọc danh sách nhân viên thuộc một bộ phận cụ thể.
                  </td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-mono-num font-bold text-blue-700">
                    msnv
                  </td>
                  <td className="py-2 px-3 text-slate-500">string</td>
                  <td className="py-2 px-3 font-mono-num">
                    ?msnv=90993,00441
                  </td>
                  <td className="py-2 px-3 text-slate-700">
                    Lọc theo 1 hoặc nhiều mã số nhân viên (cách nhau bằng dấu
                    phẩy).
                  </td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-mono-num font-bold text-blue-700">
                    page &amp; limit
                  </td>
                  <td className="py-2 px-3 text-slate-500">number</td>
                  <td className="py-2 px-3 font-mono-num">?page=1&amp;limit=50</td>
                  <td className="py-2 px-3 text-slate-700">
                    Phân trang kết quả trả về. Nếu không truyền{' '}
                    <code>limit</code>, API trả về toàn bộ danh sách.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Code Snippets & Live API Tester */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Code Snippets (6 cols) */}
          <div className="lg:col-span-6 border border-slate-200 rounded-lg overflow-hidden flex flex-col">
            <div className="px-3.5 py-2 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold">
                <Code2 className="w-4 h-4 text-blue-400" />
                Code Mẫu Tích Hợp Vào Website Khác
              </div>
              <div className="flex items-center gap-1">
                {(
                  [
                    { id: 'js', label: 'JavaScript' },
                    { id: 'react', label: 'React / Next.js' },
                    { id: 'php', label: 'PHP' },
                    { id: 'curl', label: 'cURL' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setCodeTab(t.id)}
                    className={`px-2 py-1 text-[11px] font-bold rounded cursor-pointer ${
                      codeTab === t.id
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    handleCopy(codeSnippets[codeTab], `snippet-${codeTab}`)
                  }
                  className="ml-1 inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded cursor-pointer"
                >
                  {copiedKey === `snippet-${codeTab}` ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      Đã copy
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      Copy
                    </>
                  )}
                </button>
              </div>
            </div>
            <pre className="p-4 bg-slate-950 text-slate-100 text-[11px] font-mono-num overflow-x-auto flex-1 leading-relaxed">
              {codeSnippets[codeTab]}
            </pre>
          </div>

          {/* Live API Tester (6 cols) */}
          <div className="lg:col-span-6 border border-slate-200 rounded-lg overflow-hidden flex flex-col">
            <div className="px-3.5 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800">
                Chạy Thử API Trực Tiếp (Live JSON Response)
              </span>
              <button
                type="button"
                disabled={isTestingApi}
                onClick={() => handleRunApiTest()}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded cursor-pointer disabled:opacity-50"
              >
                {isTestingApi ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                Gửi Request (GET)
              </button>
            </div>
            <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
              <span className="px-2 py-1 text-[10px] font-bold bg-blue-700 text-white rounded">
                GET
              </span>
              <input
                type="text"
                value={testEndpoint}
                onChange={(e) => setTestEndpoint(e.target.value)}
                className="flex-1 px-2.5 py-1 text-xs font-mono-num bg-white border border-slate-300 rounded focus:outline-none focus:border-blue-600"
              />
            </div>
            <pre className="p-4 bg-slate-950 text-emerald-400 text-[11px] font-mono-num overflow-auto max-h-64 flex-1 leading-relaxed">
              {apiTestResult ||
                '// Bấm nút "Test" ở các endpoint phía trên hoặc bấm "Gửi Request (GET)" để xem dữ liệu JSON thực tế trả về từ API...'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

