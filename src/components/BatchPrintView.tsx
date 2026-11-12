import React, { useState, useMemo, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import {
  Printer,
  FileDown,
  Search,
  CheckSquare,
  Square,
  Layers,
  Sliders,
  CheckCircle2,
  CreditCard,
  FileText,
  RefreshCw,
  Calendar,
  X,
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { AppSettings, CardTemplate, Employee } from '../types';
import { IdCardPreview } from './IdCardPreview';
import { triggerBrowserCtrlP } from '../utils/nativePrint';
import { parseDateToUtcTimestamp } from './EmployeeManagementView';

interface BatchPrintViewProps {
  employees: Employee[];
  templates: CardTemplate[];
  selectedTemplate: CardTemplate;
  onSelectTemplate: (template: CardTemplate) => void;
  selectedEmployeeIds: Set<string>;
  onChangeSelectedIds: (ids: Set<string>) => void;
  settings: AppSettings;
  onRecordPrintJob: (
    printedEmployees: Employee[],
    printMode: 'a4_grid' | 'cr80_direct' | 'pdf_export',
    templateName: string,
    totalPages: number,
    paperSize: string,
    duplex: boolean
  ) => Promise<void>;
  onOpenPrintDialog: (employeeIds?: string[]) => void;
}

interface PrintPageDescriptor {
  pageNumber: number;
  employees: Employee[];
}

export const BatchPrintView: React.FC<BatchPrintViewProps> = ({
  employees,
  templates,
  selectedTemplate,
  onSelectTemplate,
  selectedEmployeeIds,
  onChangeSelectedIds,
  settings,
  onRecordPrintJob,
  onOpenPrintDialog,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [printStatusFilter, setPrintStatusFilter] = useState<
    'ALL' | 'UNPRINTED' | 'PRINTED'
  >('ALL');
  const [joinDateFrom, setJoinDateFrom] = useState('');
  const [joinDateTo, setJoinDateTo] = useState('');

  // Print Layout Settings
  const [printMethod, setPrintMethod] = useState<'a4_sheet' | 'cr80_printer'>(
    settings.defaultPaperSize === 'CR80' ? 'cr80_printer' : 'a4_sheet'
  );
  const [paperSize, setPaperSize] = useState<'A4' | 'Letter'>('A4');
  const [cols, setCols] = useState<number>(settings.defaultCols || 2);
  const [rows, setRows] = useState<number>(settings.defaultRows || 4);
  const [gapMm, setGapMm] = useState<number>(settings.defaultGapMm ?? 4);
  const [marginMm, setMarginMm] = useState<number>(
    settings.defaultMarginMm ?? 10
  );
  const [cardWidthMm, setCardWidthMm] = useState<number>(
    settings.cardWidthMm || 85.6
  );
  const [cardHeightMm, setCardHeightMm] = useState<number>(
    settings.cardHeightMm || 54
  );
  const [showCropMarks, setShowCropMarks] = useState<boolean>(true);
  const [previewScale, setPreviewScale] = useState<number>(0.78);

  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const sheetRefs = useRef<Array<HTMLDivElement | null>>([]);
  const hasAutoSelectedRef = useRef(false);

  // Auto-select all employees on first open if none are currently selected
  useEffect(() => {
    if (
      !hasAutoSelectedRef.current &&
      selectedEmployeeIds.size === 0 &&
      employees.length > 0
    ) {
      hasAutoSelectedRef.current = true;
      onChangeSelectedIds(new Set(employees.map((e) => e.id)));
    }
  }, [employees, selectedEmployeeIds.size, onChangeSelectedIds]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    employees.forEach((e) => {
      if (e.department) set.add(e.department);
    });
    return Array.from(set).sort();
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    const fromTs = parseDateToUtcTimestamp(joinDateFrom);
    const toTs = parseDateToUtcTimestamp(joinDateTo);

    return employees.filter((emp) => {
      const q = searchQuery.trim().toLowerCase();
      const matchQuery =
        !q ||
        emp.fullName.toLowerCase().includes(q) ||
        emp.msnv.toLowerCase().includes(q);
      const matchDept = deptFilter === 'ALL' || emp.department === deptFilter;
      const matchPrint =
        printStatusFilter === 'ALL' ||
        (printStatusFilter === 'UNPRINTED' &&
          (!emp.printCount || emp.printCount === 0)) ||
        (printStatusFilter === 'PRINTED' && emp.printCount > 0);

      let matchJoinDate = true;
      if (fromTs !== null || toTs !== null) {
        const empTs = parseDateToUtcTimestamp(emp.joinDate);
        if (empTs === null) {
          matchJoinDate = false;
        } else {
          if (fromTs !== null && empTs < fromTs) matchJoinDate = false;
          if (toTs !== null && empTs > toTs) matchJoinDate = false;
        }
      }

      return matchQuery && matchDept && matchPrint && matchJoinDate;
    });
  }, [employees, searchQuery, deptFilter, printStatusFilter, joinDateFrom, joinDateTo]);

  const selectedEmployeesList = useMemo(() => {
    return employees.filter((emp) => selectedEmployeeIds.has(emp.id));
  }, [employees, selectedEmployeeIds]);

  // Build paginated pages
  const pages: PrintPageDescriptor[] = useMemo(() => {
    if (selectedEmployeesList.length === 0) return [];

    const cardsPerPage =
      printMethod === 'cr80_printer' ? 1 : Math.max(1, cols * rows);
    const result: PrintPageDescriptor[] = [];
    let pageCounter = 1;

    for (let i = 0; i < selectedEmployeesList.length; i += cardsPerPage) {
      result.push({
        pageNumber: pageCounter++,
        employees: selectedEmployeesList.slice(i, i + cardsPerPage),
      });
    }

    return result;
  }, [selectedEmployeesList, printMethod, cols, rows]);

  // Selection helpers
  const toggleEmployee = (id: string) => {
    const next = new Set(selectedEmployeeIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onChangeSelectedIds(next);
  };

  const selectQuickCount = (count: number) => {
    const next = new Set<string>();
    filteredEmployees.slice(0, count).forEach((emp) => next.add(emp.id));
    onChangeSelectedIds(next);
  };

  const selectAllFiltered = () => {
    const next = new Set(selectedEmployeeIds);
    filteredEmployees.forEach((emp) => next.add(emp.id));
    onChangeSelectedIds(next);
  };

  const selectAllEmployees = () => {
    onChangeSelectedIds(new Set(employees.map((e) => e.id)));
  };

  const clearSelection = () => {
    onChangeSelectedIds(new Set());
  };

  // Synchronously trigger native browser Ctrl+P print dialog
  const triggerNativeCtrlP = (targetEmployees: Employee[]) => {
    if (targetEmployees.length === 0) return;

    const targetIds = targetEmployees.map((e) => e.id);
    flushSync(() => {
      onChangeSelectedIds(new Set(targetIds));
    });

    const isPortrait = selectedTemplate.orientation === 'portrait';
    const wMm = isPortrait
      ? Math.min(cardWidthMm, cardHeightMm)
      : Math.max(cardWidthMm, cardHeightMm);
    const hMm = isPortrait
      ? Math.max(cardWidthMm, cardHeightMm)
      : Math.min(cardWidthMm, cardHeightMm);

    const pageSizeCss =
      printMethod === 'cr80_printer'
        ? `${wMm}mm ${hMm}mm`
        : paperSize === 'A4'
          ? '210mm 297mm'
          : '215.9mm 279.4mm';

    triggerBrowserCtrlP(pageSizeCss);

    const cardsPerPage =
      printMethod === 'cr80_printer' ? 1 : Math.max(1, cols * rows);
    const totalPagesPrinted = Math.ceil(targetEmployees.length / cardsPerPage);

    void onRecordPrintJob(
      targetEmployees,
      printMethod === 'cr80_printer' ? 'cr80_direct' : 'a4_grid',
      selectedTemplate.name,
      totalPagesPrinted,
      printMethod === 'cr80_printer' ? `CR80 (${wMm}x${hMm}mm)` : paperSize,
      false
    );
  };

  const handleDirectPrint = () => {
    triggerNativeCtrlP(selectedEmployeesList);
  };

  const handlePrintSingleEmployee = (emp: Employee) => {
    triggerNativeCtrlP([emp]);
  };

  // High-Resolution True-Millimeter PDF Export
  const handleExportPdf = async () => {
    if (selectedEmployeesList.length === 0 || pages.length === 0) return;
    setIsExportingPdf(true);
    setStatusBanner(null);

    try {
      const isPortraitCard = selectedTemplate.orientation === 'portrait';
      const wMm = isPortraitCard
        ? Math.min(cardWidthMm, cardHeightMm)
        : Math.max(cardWidthMm, cardHeightMm);
      const hMm = isPortraitCard
        ? Math.max(cardWidthMm, cardHeightMm)
        : Math.min(cardWidthMm, cardHeightMm);

      const sheetWidthMm =
        printMethod === 'cr80_printer' ? wMm : paperSize === 'A4' ? 210 : 215.9;
      const sheetHeightMm =
        printMethod === 'cr80_printer' ? hMm : paperSize === 'A4' ? 297 : 279.4;

      const pdf = new jsPDF({
        orientation: sheetWidthMm > sheetHeightMm ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [sheetWidthMm, sheetHeightMm],
      });

      for (let i = 0; i < pages.length; i++) {
        const node = sheetRefs.current[i];
        if (!node) continue;

        const dataUrl = await toPng(node, {
          quality: 1,
          pixelRatio: 3,
          backgroundColor: '#ffffff',
        });

        if (i > 0) {
          pdf.addPage(
            [sheetWidthMm, sheetHeightMm],
            sheetWidthMm > sheetHeightMm ? 'landscape' : 'portrait'
          );
        }
        pdf.addImage(dataUrl, 'PNG', 0, 0, sheetWidthMm, sheetHeightMm);
      }

      const fileName = `In_The_Nhan_Vien_${selectedEmployeesList.length}_The_${new Date()
        .toISOString()
        .slice(0, 10)}.pdf`;
      pdf.save(fileName);

      await onRecordPrintJob(
        selectedEmployeesList,
        'pdf_export',
        selectedTemplate.name,
        pages.length,
        printMethod === 'cr80_printer' ? `CR80 (${wMm}x${hMm}mm)` : paperSize,
        false
      );

      setStatusBanner(
        `Đã xuất file PDF (${fileName}) gồm ${selectedEmployeesList.length} thẻ trên ${pages.length} trang chuẩn kích thước mm!`
      );
      setTimeout(() => setStatusBanner(null), 6000);
    } catch (err) {
      console.error('PDF export error:', err);
      setStatusBanner(
        'Có lỗi khi tạo file PDF. Vui lòng thử lại hoặc dùng nút In Trực Tiếp.'
      );
    } finally {
      setIsExportingPdf(false);
    }
  };

  const isPortraitCard = selectedTemplate.orientation === 'portrait';
  const actualCardW = isPortraitCard
    ? Math.min(cardWidthMm, cardHeightMm)
    : Math.max(cardWidthMm, cardHeightMm);
  const actualCardH = isPortraitCard
    ? Math.max(cardWidthMm, cardHeightMm)
    : Math.min(cardWidthMm, cardHeightMm);

  const sheetWidthMm =
    printMethod === 'cr80_printer'
      ? actualCardW
      : paperSize === 'A4'
        ? 210
        : 215.9;
  const sheetHeightMm =
    printMethod === 'cr80_printer'
      ? actualCardH
      : paperSize === 'A4'
        ? 297
        : 279.4;

  return (
    <div className="space-y-6">
      {/* Top Action & Status Bar (Hidden during print) */}
      <div className="no-print bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Printer className="w-5 h-5 text-blue-700" />
            Trung Tâm In Thẻ Nhân Viên Hàng Loạt & Xuất PDF Chuẩn Kích Thước
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 font-mono-num">
            Đã chọn:{' '}
            <strong className="text-blue-700">
              {selectedEmployeesList.length}
            </strong>{' '}
            nhân viên · Tổng số trang in:{' '}
            <strong className="text-blue-700">{pages.length}</strong> trang ·
            Kích thước thẻ chuẩn:{' '}
            <strong className="text-slate-800">
              {actualCardW}mm × {actualCardH}mm (CR80)
            </strong>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={selectedEmployeesList.length === 0 || isExportingPdf}
            onClick={handleExportPdf}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 cursor-pointer transition-colors"
          >
            {isExportingPdf ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Đang kết xuất PDF (300 DPI)...
              </>
            ) : (
              <>
                <FileDown className="w-4 h-4" />
                Xuất File PDF ({pages.length} trang)
              </>
            )}
          </button>

          <button
            type="button"
            disabled={selectedEmployeesList.length === 0}
            onClick={handleDirectPrint}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50 cursor-pointer shadow-xs transition-colors"
          >
            <Printer className="w-4 h-4" />
            In Trực Tiếp Ngay ({selectedEmployeesList.length} thẻ)
          </button>
        </div>
      </div>

      {statusBanner && (
        <div className="no-print p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold flex items-center gap-2.5">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{statusBanner}</span>
        </div>
      )}

      {/* Main Split Grid: Left Employee Selector + Right Print Configuration & Sheet Preview */}
      <div className="no-print grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Employee Selection & Batch Filters (5 cols) */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                1. Chọn Nhân Viên Cần In Thẻ
              </span>
              <span className="text-xs font-mono-num font-bold text-blue-700">
                Đã chọn {selectedEmployeesList.length} / {employees.length} NV
              </span>
            </div>

            {/* Search & Filters */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm theo tên hoặc MSNV trước khi chọn in..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
              >
                <option value="ALL">
                  Tất cả bộ phận ({employees.length})
                </option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>

              <select
                value={printStatusFilter}
                onChange={(e) =>
                  setPrintStatusFilter(
                    e.target.value as 'ALL' | 'UNPRINTED' | 'PRINTED'
                  )
                }
                className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
              >
                <option value="ALL">Mọi trạng thái in</option>
                <option value="UNPRINTED">Chưa in thẻ lần nào</option>
                <option value="PRINTED">Đã từng in thẻ</option>
              </select>
            </div>

            {/* Join Date Range Filter */}
            <div className="flex flex-wrap items-center gap-1.5 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs">
              <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                <Calendar className="w-3.5 h-3.5 text-blue-600" />
                Ngày vào:
              </span>
              <input
                type="date"
                value={joinDateFrom}
                onChange={(e) => setJoinDateFrom(e.target.value)}
                className="px-1.5 py-0.5 border border-slate-300 rounded font-mono-num text-[11px]"
                title="Từ ngày vào làm"
              />
              <span className="text-slate-400">→</span>
              <input
                type="date"
                value={joinDateTo}
                onChange={(e) => setJoinDateTo(e.target.value)}
                className="px-1.5 py-0.5 border border-slate-300 rounded font-mono-num text-[11px]"
                title="Đến ngày vào làm"
              />
              {(joinDateFrom || joinDateTo) && (
                <button
                  type="button"
                  onClick={() => {
                    setJoinDateFrom('');
                    setJoinDateTo('');
                  }}
                  className="p-0.5 text-red-600 hover:bg-red-50 rounded cursor-pointer"
                  title="Xóa lọc ngày"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Quick Batch Selection Buttons (1, 10, 50, All) */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <button
                type="button"
                onClick={selectAllEmployees}
                className="px-2.5 py-1 text-[11px] font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded cursor-pointer"
              >
                Chọn tất cả ({employees.length})
              </button>
              <button
                type="button"
                onClick={selectAllFiltered}
                className="px-2.5 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded cursor-pointer"
              >
                Chọn theo bộ lọc ({filteredEmployees.length})
              </button>
              <button
                type="button"
                onClick={() => selectQuickCount(1)}
                className="px-2 py-1 text-[11px] font-mono-num font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded cursor-pointer"
              >
                Chọn 1
              </button>
              <button
                type="button"
                onClick={() => selectQuickCount(10)}
                className="px-2 py-1 text-[11px] font-mono-num font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded cursor-pointer"
              >
                Chọn 10
              </button>
              <button
                type="button"
                onClick={() => selectQuickCount(50)}
                className="px-2 py-1 text-[11px] font-mono-num font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded cursor-pointer"
              >
                Chọn 50
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="px-2 py-1 text-[11px] font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded cursor-pointer ml-auto"
              >
                Bỏ chọn
              </button>
            </div>
          </div>

          {/* Employee Checklist Table */}
          <div className="max-h-[460px] overflow-y-auto divide-y divide-slate-200">
            {filteredEmployees.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Không tìm thấy nhân viên phù hợp với bộ lọc.
              </div>
            ) : (
              filteredEmployees.map((emp) => {
                const isSelected = selectedEmployeeIds.has(emp.id);
                return (
                  <div
                    key={emp.id}
                    onClick={() => toggleEmployee(emp.id)}
                    className={`px-4 py-2.5 flex items-center justify-between gap-2 cursor-pointer transition-colors text-xs ${
                      isSelected
                        ? 'bg-blue-50/70 hover:bg-blue-50'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        type="button"
                        className="text-blue-600 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleEmployee(emp.id);
                        }}
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-400" />
                        )}
                      </button>
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 truncate">
                          {emp.fullName}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          MSNV:{' '}
                          <strong className="font-mono-num text-slate-700">
                            {emp.msnv}
                          </strong>{' '}
                          · {emp.department}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono-num text-[11px]">
                        {emp.printCount > 0 ? (
                          <span className="text-emerald-700 font-medium">
                            Đã in {emp.printCount}l
                          </span>
                        ) : (
                          <span className="text-amber-600">Chưa in</span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePrintSingleEmployee(emp);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-white bg-blue-700 hover:bg-blue-800 rounded cursor-pointer"
                        title="In ngay thẻ của nhân viên này"
                      >
                        <Printer className="w-3 h-3" />
                        In
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Sticky Bottom Print Button inside Employee Selection Table */}
          <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-700">
              Tổng cộng: <strong className="text-blue-700 font-mono-num">{selectedEmployeesList.length}</strong> thẻ
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={selectedEmployeesList.length === 0 || isExportingPdf}
                onClick={handleExportPdf}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-blue-700 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 disabled:opacity-50 cursor-pointer"
              >
                <FileDown className="w-3.5 h-3.5" />
                Xuất PDF
              </button>
              <button
                type="button"
                disabled={selectedEmployeesList.length === 0}
                onClick={handleDirectPrint}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded-lg disabled:opacity-50 cursor-pointer shadow-xs"
              >
                <Printer className="w-3.5 h-3.5" />
                In Ngay ({selectedEmployeesList.length} thẻ)
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Print Configuration & Multi-Page Sheet Preview (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          {/* Configuration Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
                <Sliders className="w-4 h-4 text-blue-600" />
                2. Cấu Hình Phương Thức In & Dàn Trang
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500">Mẫu thiết kế:</span>
                <select
                  value={selectedTemplate.id}
                  onChange={(e) => {
                    const found = templates.find(
                      (t) => t.id === e.target.value
                    );
                    if (found) onSelectTemplate(found);
                  }}
                  className="px-2.5 py-1 font-semibold bg-slate-50 border border-slate-300 rounded-lg"
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Method Selector: A4 Multi-card Sheet vs Dedicated CR80 Plastic Card Printer */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPrintMethod('a4_sheet')}
                className={`p-3 rounded-lg border text-left flex items-start gap-3 cursor-pointer transition-colors ${
                  printMethod === 'a4_sheet'
                    ? 'border-blue-600 bg-blue-50/50'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <FileText className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-slate-900">
                    In Nhiều Thẻ Trên Giấy A4 / Letter
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Tự động dàn nhiều thẻ trên 1 trang giấy A4 (tiết kiệm giấy,
                    có đường viền cắt)
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setPrintMethod('cr80_printer')}
                className={`p-3 rounded-lg border text-left flex items-start gap-3 cursor-pointer transition-colors ${
                  printMethod === 'cr80_printer'
                    ? 'border-blue-600 bg-blue-50/50'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <CreditCard className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-slate-900">
                    Máy In Thẻ Nhựa Chuyên Dụng (CR80)
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Mỗi thẻ 1 trang đúng khổ phôi thẻ PVC chuẩn 85.6mm × 54mm
                  </div>
                </div>
              </button>
            </div>

            {/* Grid, Margin, & Gap Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Rộng × Cao thẻ (mm)
                </label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.1"
                    value={cardWidthMm}
                    onChange={(e) =>
                      setCardWidthMm(Number(e.target.value) || 85.6)
                    }
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-lg font-mono-num"
                  />
                  <span>×</span>
                  <input
                    type="number"
                    step="0.1"
                    value={cardHeightMm}
                    onChange={(e) =>
                      setCardHeightMm(Number(e.target.value) || 54)
                    }
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-lg font-mono-num"
                  />
                </div>
              </div>

              {printMethod === 'a4_sheet' && (
                <>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Số Cột × Số Hàng / trang
                    </label>
                    <div className="flex items-center gap-1">
                      <select
                        value={cols}
                        onChange={(e) => setCols(Number(e.target.value))}
                        className="w-full px-2 py-1.5 border border-slate-300 rounded-lg font-mono-num bg-white"
                      >
                        <option value={1}>1 cột</option>
                        <option value={2}>2 cột</option>
                        <option value={3}>3 cột</option>
                      </select>
                      <span>×</span>
                      <select
                        value={rows}
                        onChange={(e) => setRows(Number(e.target.value))}
                        className="w-full px-2 py-1.5 border border-slate-300 rounded-lg font-mono-num bg-white"
                      >
                        <option value={1}>1 hàng</option>
                        <option value={2}>2 hàng</option>
                        <option value={3}>3 hàng</option>
                        <option value={4}>4 hàng</option>
                        <option value={5}>5 hàng</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Lề giấy / Khoảng cách (mm)
                    </label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={30}
                        value={marginMm}
                        onChange={(e) => setMarginMm(Number(e.target.value))}
                        className="w-full px-2 py-1.5 border border-slate-300 rounded-lg font-mono-num"
                        title="Lề trang giấy (mm)"
                      />
                      <span>/</span>
                      <input
                        type="number"
                        min={0}
                        max={20}
                        value={gapMm}
                        onChange={(e) => setGapMm(Number(e.target.value))}
                        className="w-full px-2 py-1.5 border border-slate-300 rounded-lg font-mono-num"
                        title="Khoảng cách giữa các thẻ (mm)"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {printMethod === 'a4_sheet' && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 text-xs">
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showCropMarks}
                      onChange={(e) => setShowCropMarks(e.target.checked)}
                      className="accent-blue-600"
                    />
                    <span className="text-slate-700">
                      Hiển thị đường nét đứt hỗ trợ cắt thẻ
                    </span>
                  </label>

                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-500">Khổ giấy:</span>
                    <select
                      value={paperSize}
                      onChange={(e) =>
                        setPaperSize(e.target.value as 'A4' | 'Letter')
                      }
                      className="px-2 py-1 border border-slate-300 rounded bg-white font-mono-num"
                    >
                      <option value="A4">A4 (210 × 297 mm)</option>
                      <option value="Letter">Letter (215.9 × 279.4 mm)</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Thu phóng bản xem trước:</span>
                  <button
                    type="button"
                    onClick={() => setPreviewScale(0.65)}
                    className={`px-2 py-0.5 rounded font-mono-num cursor-pointer ${
                      previewScale === 0.65
                        ? 'bg-blue-100 text-blue-700 font-bold'
                        : 'bg-slate-100'
                    }`}
                  >
                    65%
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewScale(0.78)}
                    className={`px-2 py-0.5 rounded font-mono-num cursor-pointer ${
                      previewScale === 0.78
                        ? 'bg-blue-100 text-blue-700 font-bold'
                        : 'bg-slate-100'
                    }`}
                  >
                    78%
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewScale(1)}
                    className={`px-2 py-0.5 rounded font-mono-num cursor-pointer ${
                      previewScale === 1
                        ? 'bg-blue-100 text-blue-700 font-bold'
                        : 'bg-slate-100'
                    }`}
                  >
                    100%
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Multi-Page Preview Container (Bảng In) with built-in Print & PDF buttons */}
          <div className="bg-slate-200/80 border border-slate-300 rounded-xl p-5 space-y-5 max-h-[780px] overflow-auto">
            {/* Top Bar inside Bảng In */}
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                <Layers className="w-4 h-4 text-blue-700" />
                <span>
                  Bảng Xem Trước Trang In ({pages.length} trang ·{' '}
                  {selectedEmployeesList.length} thẻ)
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={selectedEmployeesList.length === 0 || isExportingPdf}
                  onClick={handleExportPdf}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 cursor-pointer"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  Xuất PDF
                </button>
                <button
                  type="button"
                  disabled={selectedEmployeesList.length === 0}
                  onClick={handleDirectPrint}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded-lg disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  <Printer className="w-3.5 h-3.5" />
                  In Thẻ Ngay ({selectedEmployeesList.length} thẻ)
                </button>
              </div>
            </div>

            {pages.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center border border-slate-200 space-y-3">
                <Printer className="w-10 h-10 text-slate-300 mx-auto" />
                <div className="text-sm font-bold text-slate-700">
                  Chưa có nhân viên nào được chọn để in
                </div>
                <div className="text-xs text-slate-500">
                  Bấm nút bên dưới để chọn tất cả nhân viên và hiển thị bảng in ngay lập tức.
                </div>
                <button
                  type="button"
                  onClick={selectAllEmployees}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  Chọn Tất Cả Nhân Viên Để In ({employees.length} thẻ)
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-8">
                {pages.map((page, pageIdx) => (
                  <div
                    key={page.pageNumber}
                    className="flex flex-col items-center w-full"
                  >
                    <div className="mb-2.5 flex items-center justify-between w-full max-w-[640px] bg-white px-3.5 py-2 rounded-lg border border-slate-200 text-xs">
                      <span className="font-bold text-slate-800 font-mono-num">
                        Trang {page.pageNumber} / {pages.length} ({page.employees.length} thẻ)
                      </span>
                      <button
                        type="button"
                        onClick={() => triggerNativeCtrlP(page.employees)}
                        className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        In Ngay
                      </button>
                    </div>

                    {/* Scaled wrapper for screen preview */}
                    <div
                      style={{
                        width: `${sheetWidthMm * (printMethod === 'cr80_printer' ? 1.3 : previewScale)}mm`,
                        height: `${sheetHeightMm * (printMethod === 'cr80_printer' ? 1.3 : previewScale)}mm`,
                      }}
                      className="relative overflow-hidden shadow-lg bg-white"
                    >
                      <div
                        style={{
                          transform: `scale(${printMethod === 'cr80_printer' ? 1.3 : previewScale})`,
                          transformOrigin: 'top left',
                          width: `${sheetWidthMm}mm`,
                          height: `${sheetHeightMm}mm`,
                        }}
                      >
                        <div
                          ref={(el) => {
                            sheetRefs.current[pageIdx] = el;
                          }}
                          className="bg-white box-border"
                          style={{
                            width: `${sheetWidthMm}mm`,
                            height: `${sheetHeightMm}mm`,
                            padding:
                              printMethod === 'cr80_printer'
                                ? '0mm'
                                : `${marginMm}mm`,
                          }}
                        >
                          {printMethod === 'cr80_printer' ? (
                            <IdCardPreview
                              employee={page.employees[0]}
                              template={selectedTemplate}
                              cardWidthMm={cardWidthMm}
                              cardHeightMm={cardHeightMm}
                            />
                          ) : (
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: `repeat(${cols}, ${actualCardW}mm)`,
                                gap: `${gapMm}mm`,
                                justifyContent: 'center',
                              }}
                            >
                              {page.employees.map((emp) => (
                                <IdCardPreview
                                  key={`${page.pageNumber}-${emp.id}`}
                                  employee={emp}
                                  template={selectedTemplate}
                                  cardWidthMm={cardWidthMm}
                                  cardHeightMm={cardHeightMm}
                                  showCropMarks={showCropMarks}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Dedicated 1:1 Physical Print Root (Visible ONLY during window.print() / Ctrl+P) */}
      <div id="printable-cards-root">
        {pages.map((page) => (
          <div
            key={`print-page-${page.pageNumber}`}
            className="print-sheet bg-white box-border"
            style={{
              width: `${sheetWidthMm}mm`,
              height: `${sheetHeightMm}mm`,
              padding:
                printMethod === 'cr80_printer' ? '0mm' : `${marginMm}mm`,
            }}
          >
            {printMethod === 'cr80_printer' ? (
              <IdCardPreview
                employee={page.employees[0]}
                template={selectedTemplate}
                cardWidthMm={cardWidthMm}
                cardHeightMm={cardHeightMm}
              />
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${cols}, ${actualCardW}mm)`,
                  gap: `${gapMm}mm`,
                  justifyContent: 'center',
                }}
              >
                {page.employees.map((emp) => (
                  <IdCardPreview
                    key={`print-card-${page.pageNumber}-${emp.id}`}
                    employee={emp}
                    template={selectedTemplate}
                    cardWidthMm={cardWidthMm}
                    cardHeightMm={cardHeightMm}
                    showCropMarks={showCropMarks}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
