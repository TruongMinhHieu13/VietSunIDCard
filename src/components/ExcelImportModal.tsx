import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  FileSpreadsheet,
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
  X,
  RefreshCw,
  CheckSquare,
  Square,
  Printer,
  Camera,
} from 'lucide-react';
import { Employee } from '../types';
import { compressImageTo3x4DataUrl } from './EmployeeManagementView';

export interface ParsedExcelRow {
  rowNumber: number;
  msnv: string;
  fullName: string;
  department: string;
  joinDate: string;
  photoUrl?: string;
  status: 'valid_new' | 'valid_update' | 'error';
  errors: string[];
  existingEmployeeId?: string;
  selected: boolean;
}

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingEmployees: Employee[];
  onConfirmImport: (
    rowsToImport: ParsedExcelRow[],
    importMode: 'add_only' | 'upsert',
    fileName: string,
    stats: {
      totalRows: number;
      validCount: number;
      errorCount: number;
      importedCount: number;
      updatedCount: number;
    },
    triggerPrintImmediately?: boolean
  ) => Promise<string[]>;
  onGoToPrintWithIds: (ids: string[]) => void;
}

function formatExcelDate(val: unknown): string {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'number') {
    // Excel serial date conversion
    const utcDays = Math.floor(val - 25569);
    const utcValue = utcDays * 86400;
    const dateInfo = new Date(utcValue * 1000);
    if (!isNaN(dateInfo.getTime())) {
      const dd = String(dateInfo.getUTCDate()).padStart(2, '0');
      const mm = String(dateInfo.getUTCMonth() + 1).padStart(2, '0');
      const yyyy = dateInfo.getUTCFullYear();
      return `${dd}/${mm}/${yyyy}`;
    }
  }
  const str = String(val).trim();
  // Convert YYYY-MM-DD to DD/MM/YYYY if matched
  const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    return `${isoMatch[3].padStart(2, '0')}/${isoMatch[2].padStart(2, '0')}/${isoMatch[1]}`;
  }
  // Normalize D/M/YYYY to DD/MM/YYYY
  const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    return `${dmyMatch[1].padStart(2, '0')}/${dmyMatch[2].padStart(2, '0')}/${dmyMatch[3]}`;
  }
  return str;
}

export function downloadSampleExcelTemplate() {
  const sampleData = [
    {
      MSNV: '90993',
      'Họ và tên': 'TRƯƠNG MINH HIẾU',
      'Bộ phận': 'Bảo trì vận hành',
      'Ngày vào làm': '02/10/2026',
    },
    {
      MSNV: '91001',
      'Họ và tên': 'LÊ THỊ HỒNG NHUNG',
      'Bộ phận': 'Kế toán - Tài chính',
      'Ngày vào làm': '15/10/2026',
    },
    {
      MSNV: '91002',
      'Họ và tên': 'PHẠM VĂN ĐỨC',
      'Bộ phận': 'Sản xuất - Kỹ thuật',
      'Ngày vào làm': '20/10/2026',
    },
    {
      MSNV: '91003',
      'Họ và tên': 'NGUYỄN MINH QUÂN',
      'Bộ phận': 'Bảo trì vận hành',
      'Ngày vào làm': '01/11/2026',
    },
    {
      MSNV: '91004',
      'Họ và tên': 'ĐẶNG THỊ MAI LAN',
      'Bộ phận': 'Hành chính - Nhân sự',
      'Ngày vào làm': '05/11/2026',
    },
  ];

  const worksheet = XLSX.utils.json_to_sheet(sampleData);
  worksheet['!cols'] = [
    { wch: 15 },
    { wch: 28 },
    { wch: 26 },
    { wch: 18 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'DanhSachNhanVien');
  XLSX.writeFile(workbook, 'File_Mau_Import_Nhan_Vien_VietSun.xlsx');
}

export function exportEmployeesToExcel(employees: Employee[]) {
  const rows = employees.map((emp, idx) => ({
    STT: idx + 1,
    MSNV: emp.msnv,
    'Họ và tên': emp.fullName,
    'Bộ phận': emp.department,
    'Ngày vào làm': emp.joinDate,
    'Số lần in thẻ': emp.printCount || 0,
    'Lần in gần nhất': emp.lastPrintedAt || 'Chưa in',
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 8 },
    { wch: 15 },
    { wch: 28 },
    { wch: 26 },
    { wch: 16 },
    { wch: 15 },
    { wch: 18 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'DanhSachNhanVien');
  XLSX.writeFile(
    workbook,
    `Danh_Sach_Nhan_Vien_${new Date().toISOString().slice(0, 10)}.xlsx`
  );
}

export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({
  isOpen,
  onClose,
  existingEmployees,
  onConfirmImport,
  onGoToPrintWithIds,
}) => {
  const [fileName, setFileName] = useState<string>('');
  const [rawRows, setRawRows] = useState<
    Array<{
      rowNumber: number;
      msnv: string;
      fullName: string;
      department: string;
      joinDate: string;
    }>
  >([]);
  const [rowPhotos, setRowPhotos] = useState<Record<number, string>>({});
  const [importMode, setImportMode] = useState<'add_only' | 'upsert'>('add_only');
  const [deselectedRowNums, setDeselectedRowNums] = useState<Set<number>>(new Set());
  const [filterView, setFilterView] = useState<'all' | 'valid' | 'error'>('all');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importResultBanner, setImportResultBanner] = useState<{
    importedCount: number;
    updatedCount: number;
    errorCount: number;
    importedIds: string[];
  } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const existingMap = useMemo(() => {
    const map = new Map<string, Employee>();
    existingEmployees.forEach((emp) => {
      map.set(emp.msnv.trim().toLowerCase(), emp);
    });
    return map;
  }, [existingEmployees]);

  // Re-evaluate rows whenever rawRows, importMode, or existingEmployees change
  const evaluatedRows: ParsedExcelRow[] = useMemo(() => {
    const seenInFile = new Map<string, number>();

    return rawRows.map((row) => {
      const errors: string[] = [];
      const msnvClean = row.msnv.trim();
      const nameClean = row.fullName.trim();
      const deptClean = row.department.trim();
      const dateClean = row.joinDate.trim();

      if (!msnvClean) errors.push('Thiếu Mã số nhân viên (MSNV)');
      if (!nameClean) errors.push('Thiếu Họ và tên');
      if (!deptClean) errors.push('Thiếu Bộ phận');
      if (!dateClean) errors.push('Thiếu Ngày vào làm');

      if (msnvClean.length > 50) errors.push('MSNV vượt quá 50 ký tự');
      if (nameClean.length > 120) errors.push('Họ và tên vượt quá 120 ký tự');
      if (deptClean.length > 120) errors.push('Bộ phận vượt quá 120 ký tự');

      const msnvKey = msnvClean.toLowerCase();
      if (msnvKey) {
        if (seenInFile.has(msnvKey)) {
          errors.push(
            `Trùng MSNV ngay trong file Excel (trùng với dòng ${seenInFile.get(msnvKey)})`
          );
        } else {
          seenInFile.set(msnvKey, row.rowNumber);
        }
      }

      const existingEmp = msnvKey ? existingMap.get(msnvKey) : undefined;
      if (existingEmp && importMode === 'add_only') {
        errors.push(`Trùng MSNV "${msnvClean}" đã tồn tại trong hệ thống (${existingEmp.fullName})`);
      }

      const isError = errors.length > 0;
      const status: ParsedExcelRow['status'] = isError
        ? 'error'
        : existingEmp
          ? 'valid_update'
          : 'valid_new';

      return {
        rowNumber: row.rowNumber,
        msnv: msnvClean,
        fullName: nameClean,
        department: deptClean,
        joinDate: dateClean,
        photoUrl: rowPhotos[row.rowNumber] || existingEmp?.photoUrl || '',
        status,
        errors,
        existingEmployeeId: existingEmp?.id,
        selected: !isError && !deselectedRowNums.has(row.rowNumber),
      };
    });
  }, [rawRows, importMode, existingMap, deselectedRowNums, rowPhotos]);

  const stats = useMemo(() => {
    const totalRows = evaluatedRows.length;
    const validRows = evaluatedRows.filter((r) => r.status !== 'error');
    const errorRows = evaluatedRows.filter((r) => r.status === 'error');
    const selectedRows = validRows.filter((r) => r.selected);
    const newCount = selectedRows.filter((r) => r.status === 'valid_new').length;
    const updateCount = selectedRows.filter((r) => r.status === 'valid_update').length;

    return {
      totalRows,
      validCount: validRows.length,
      errorCount: errorRows.length,
      selectedCount: selectedRows.length,
      newCount,
      updateCount,
    };
  }, [evaluatedRows]);

  const filteredRows = useMemo(() => {
    if (filterView === 'valid') {
      return evaluatedRows.filter((r) => r.status !== 'error');
    }
    if (filterView === 'error') {
      return evaluatedRows.filter((r) => r.status === 'error');
    }
    return evaluatedRows;
  }, [evaluatedRows, filterView]);

  if (!isOpen) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParseError(null);
    setImportResultBanner(null);
    setFileName(file.name);
    setDeselectedRowNums(new Set());

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = evt.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
          defval: '',
        });

        if (jsonRows.length === 0) {
          setParseError('File Excel không có dữ liệu hoặc để trống.');
          setRawRows([]);
          return;
        }

        const extracted = jsonRows.map((record, idx) => {
          // Flexible header matching
          const keys = Object.keys(record);
          const findVal = (patterns: string[]) => {
            const matchedKey = keys.find((k) => {
              const norm = k.trim().toLowerCase();
              return patterns.some((p) => norm.includes(p));
            });
            return matchedKey ? record[matchedKey] : '';
          };

          const msnvRaw = findVal(['msnv', 'mã số', 'ma so', 'mã nv', 'ma nv', 'id', 'code']);
          const nameRaw = findVal(['họ và tên', 'ho va ten', 'họ tên', 'ho ten', 'tên', 'name']);
          const deptRaw = findVal(['bộ phận', 'bo phan', 'phòng ban', 'phong ban', 'department', 'bp']);
          const dateRaw = findVal(['ngày vào', 'ngay vao', 'ngày', 'date', 'join']);

          return {
            rowNumber: idx + 2, // Excel row index (header is row 1)
            msnv: String(msnvRaw ?? '').trim(),
            fullName: String(nameRaw ?? '').trim(),
            department: String(deptRaw ?? '').trim(),
            joinDate: formatExcelDate(dateRaw),
          };
        });

        setRawRows(extracted);
      } catch (err) {
        setParseError(
          err instanceof Error
            ? `Không thể đọc file Excel: ${err.message}`
            : 'Định dạng file Excel không hợp lệ.'
        );
        setRawRows([]);
      }
    };
    reader.readAsBinaryString(file);
  };

  const toggleRowSelection = (rowNumber: number) => {
    setDeselectedRowNums((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) {
        next.delete(rowNumber);
      } else {
        next.add(rowNumber);
      }
      return next;
    });
  };

  const selectAllValid = () => {
    setDeselectedRowNums(new Set());
  };

  const deselectAllValid = () => {
    const allNums = new Set(
      evaluatedRows.filter((r) => r.status !== 'error').map((r) => r.rowNumber)
    );
    setDeselectedRowNums(allNums);
  };

  const handleConfirm = async (goToPrintAfter = false) => {
    const selectedRows = evaluatedRows.filter(
      (r) => r.status !== 'error' && r.selected
    );
    if (selectedRows.length === 0) return;

    setIsSubmitting(true);
    try {
      const importedIds = await onConfirmImport(
        selectedRows,
        importMode,
        fileName,
        {
          totalRows: stats.totalRows,
          validCount: stats.validCount,
          errorCount: stats.errorCount,
          importedCount: stats.newCount,
          updatedCount: stats.updateCount,
        },
        goToPrintAfter
      );
      if (goToPrintAfter) {
        handleReset();
        return;
      }
      setImportResultBanner({
        importedCount: stats.newCount,
        updatedCount: stats.updateCount,
        errorCount: stats.errorCount,
        importedIds,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setFileName('');
    setRawRows([]);
    setRowPhotos({});
    setDeselectedRowNums(new Set());
    setImportResultBanner(null);
    setParseError(null);
  };

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden shadow-xl">
        {/* Header */}
        <div className="px-6 py-4 bg-blue-700 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="w-6 h-6" />
            <div>
              <h2 className="text-lg font-bold">
                Import Danh Sách Nhân Viên Từ File Excel (.xlsx, .xls)
              </h2>
              <p className="text-xs text-blue-100">
                Quy trình chuẩn: Tải file mẫu → Chọn file Excel → Xem trước & kiểm tra trùng/lỗi → Xác nhận Import
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-blue-600 transition-colors"
            title="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {/* Step 1 & Step 2 Controls */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
            {/* Upload & Template Download */}
            <div className="lg:col-span-7 flex flex-col justify-between gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-800">
                  1. Chọn file Excel (.xlsx, .xls) và tải file mẫu chuẩn
                </span>
                <button
                  type="button"
                  onClick={downloadSampleExcelTemplate}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Tải File Excel Mẫu (.xlsx)
                </button>
              </div>

              <label className="flex items-center justify-center gap-3 border-2 border-dashed border-blue-300 bg-white hover:bg-blue-50/40 rounded-lg p-4 cursor-pointer transition-colors">
                <Upload className="w-5 h-5 text-blue-600 shrink-0" />
                <div className="text-left">
                  <div className="text-sm font-semibold text-slate-800">
                    {fileName ? `Đã chọn: ${fileName}` : 'Bấm để chọn file Excel (.xlsx, .xls) từ máy tính'}
                  </div>
                  <div className="text-xs text-slate-500">
                    Các cột tiêu chuẩn: 1. MSNV · 2. Họ và tên · 3. Bộ phận · 4. Ngày vào làm
                  </div>
                </div>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* Duplicate Handling Option */}
            <div className="lg:col-span-5 flex flex-col justify-between bg-white p-3.5 rounded-lg border border-slate-200">
              <div className="text-sm font-semibold text-slate-800 mb-2">
                2. Chế độ xử lý khi MSNV đã tồn tại
              </div>
              <div className="space-y-2">
                <label className="flex items-start gap-2.5 cursor-pointer text-xs">
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === 'add_only'}
                    onChange={() => setImportMode('add_only')}
                    className="mt-0.5 text-blue-600"
                  />
                  <div>
                    <span className="font-semibold text-slate-900 block">
                      Chỉ thêm nhân viên mới (Mặc định - An toàn)
                    </span>
                    <span className="text-slate-500">
                      Không ghi đè dữ liệu cũ. Báo lỗi các dòng có MSNV trùng với dữ liệu đã có.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer text-xs">
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === 'upsert'}
                    onChange={() => setImportMode('upsert')}
                    className="mt-0.5 text-blue-600"
                  />
                  <div>
                    <span className="font-semibold text-slate-900 block">
                      Cập nhật thông tin nếu MSNV đã tồn tại
                    </span>
                    <span className="text-slate-500">
                      Thêm mới nhân viên chưa có và cập nhật Họ tên, Bộ phận, Ngày vào làm cho MSNV đã tồn tại.
                    </span>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {parseError && (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}

          {importResultBanner && (
            <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                <div>
                  <div className="font-bold text-sm">
                    Hoàn tất Import dữ liệu nhân viên thành công!
                  </div>
                  <div className="text-xs text-emerald-800 mt-0.5 font-mono-num">
                    Thêm mới thành công: {importResultBanner.importedCount} nhân viên · Cập nhật:{' '}
                    {importResultBanner.updatedCount} nhân viên · Bỏ qua dòng lỗi:{' '}
                    {importResultBanner.errorCount} dòng
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-3 py-1.5 text-xs font-semibold bg-white border border-emerald-300 rounded-lg hover:bg-emerald-100 cursor-pointer"
                >
                  Import file khác
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-1.5 text-xs font-semibold bg-white text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Đóng & Xem danh sách
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const ids = importResultBanner.importedIds;
                    handleReset();
                    onGoToPrintWithIds(ids);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold bg-blue-700 text-white rounded-lg hover:bg-blue-800 cursor-pointer shadow-xs"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Chuyển Qua In Ngay ({importResultBanner.importedIds.length} thẻ)
                </button>
              </div>
            </div>
          )}

          {/* Preview & Validation Table */}
          {evaluatedRows.length > 0 && (
            <div className="space-y-3">
              {/* Summary Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-lg border border-slate-200">
                <div className="flex flex-wrap items-center gap-4 text-xs font-mono-num">
                  <span className="font-semibold text-slate-700">
                    Tổng số dòng đọc được: <strong>{stats.totalRows}</strong>
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="text-emerald-700 font-semibold">
                    Dòng hợp lệ: <strong>{stats.validCount}</strong> (Thêm mới: {stats.newCount}, Cập nhật: {stats.updateCount})
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="text-red-600 font-semibold">
                    Dòng bị lỗi (không import): <strong>{stats.errorCount}</strong>
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="text-blue-700 font-bold">
                    Đã chọn Import: {stats.selectedCount} dòng
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setFilterView('all')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer ${
                        filterView === 'all'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Tất cả ({stats.totalRows})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterView('valid')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer ${
                        filterView === 'valid'
                          ? 'bg-white text-emerald-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Hợp lệ ({stats.validCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterView('error')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer ${
                        filterView === 'error'
                          ? 'bg-white text-red-600 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Dòng lỗi ({stats.errorCount})
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={selectAllValid}
                    className="px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg cursor-pointer"
                  >
                    Chọn tất cả dòng hợp lệ
                  </button>
                  <button
                    type="button"
                    onClick={deselectAllValid}
                    className="px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                  >
                    Bỏ chọn
                  </button>
                </div>
              </div>

              {/* Data Table */}
              <div className="border border-slate-200 rounded-lg overflow-hidden max-h-[360px] overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-100 text-slate-700 sticky top-0 z-10 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3 w-10 text-center">Chọn</th>
                      <th className="py-2.5 px-3 w-16 font-mono-num">Dòng Excel</th>
                      <th className="py-2.5 px-3 w-20 text-center">Ảnh 3×4</th>
                      <th className="py-2.5 px-3 w-28">MSNV</th>
                      <th className="py-2.5 px-3">Họ và tên</th>
                      <th className="py-2.5 px-3">Bộ phận</th>
                      <th className="py-2.5 px-3 w-28">Ngày vào làm</th>
                      <th className="py-2.5 px-3 w-36">Trạng thái</th>
                      <th className="py-2.5 px-3">Chi tiết kiểm tra / Nguyên nhân lỗi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {filteredRows.map((row) => {
                      const isError = row.status === 'error';
                      return (
                        <tr
                          key={row.rowNumber}
                          className={
                            isError
                              ? 'bg-red-50/60 hover:bg-red-50'
                              : row.selected
                                ? 'bg-white hover:bg-blue-50/40'
                                : 'bg-slate-50/60 opacity-70'
                          }
                        >
                          <td className="py-2 px-3 text-center">
                            {isError ? (
                              <span title="Dòng lỗi không thể import">
                                <X className="w-4 h-4 text-red-500 mx-auto" />
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => toggleRowSelection(row.rowNumber)}
                                className="text-blue-600 hover:text-blue-800 cursor-pointer"
                              >
                                {row.selected ? (
                                  <CheckSquare className="w-4 h-4" />
                                ) : (
                                  <Square className="w-4 h-4 text-slate-400" />
                                )}
                              </button>
                            )}
                          </td>
                          <td className="py-2 px-3 font-mono-num text-slate-500">
                            #{row.rowNumber}
                          </td>
                          <td className="py-1.5 px-3 text-center">
                            {!isError && (
                              <label
                                className="w-8 h-10 rounded border border-slate-300 bg-white overflow-hidden inline-flex flex-col items-center justify-center cursor-pointer hover:border-blue-600"
                                title="Bấm để chọn ảnh 3×4 cho dòng này"
                              >
                                {row.photoUrl ? (
                                  <img
                                    src={row.photoUrl}
                                    alt={row.fullName}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <div className="flex flex-col items-center justify-center text-blue-600">
                                    <Camera className="w-3 h-3" />
                                    <span className="text-[8px] font-bold leading-none mt-0.5">
                                      3×4
                                    </span>
                                  </div>
                                )}
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    try {
                                      const compressed =
                                        await compressImageTo3x4DataUrl(file);
                                      setRowPhotos((prev) => ({
                                        ...prev,
                                        [row.rowNumber]: compressed,
                                      }));
                                    } finally {
                                      e.target.value = '';
                                    }
                                  }}
                                  className="hidden"
                                />
                              </label>
                            )}
                          </td>
                          <td className="py-2 px-3 font-mono-num font-semibold text-slate-900">
                            {row.msnv || <span className="text-red-500 italic">(Trống)</span>}
                          </td>
                          <td className="py-2 px-3 font-medium text-slate-900">
                            {row.fullName || <span className="text-red-500 italic">(Trống)</span>}
                          </td>
                          <td className="py-2 px-3 text-slate-700">
                            {row.department || <span className="text-red-500 italic">(Trống)</span>}
                          </td>
                          <td className="py-2 px-3 font-mono-num text-slate-700">
                            {row.joinDate || <span className="text-red-500 italic">(Trống)</span>}
                          </td>
                          <td className="py-2 px-3 font-semibold">
                            {row.status === 'valid_new' && (
                              <span className="text-emerald-700">Hợp lệ (Thêm mới)</span>
                            )}
                            {row.status === 'valid_update' && (
                              <span className="text-blue-700">Hợp lệ (Cập nhật)</span>
                            )}
                            {row.status === 'error' && (
                              <span className="text-red-600">Dòng lỗi</span>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            {isError ? (
                              <span className="text-red-600 font-medium">
                                {row.errors.join(' · ')}
                              </span>
                            ) : row.status === 'valid_update' ? (
                              <span className="text-blue-700">
                                Sẽ cập nhật thông tin cho MSNV {row.msnv}
                              </span>
                            ) : (
                              <span className="text-emerald-700">
                                Đầy đủ thông tin, MSNV không trùng
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500">
            Lưu ý: Hệ thống chỉ import các dòng hợp lệ được tích chọn và tự động loại bỏ các dòng lỗi.
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              Đóng
            </button>
            {importResultBanner ? (
              <button
                type="button"
                onClick={() => {
                  const ids = importResultBanner.importedIds;
                  handleReset();
                  onGoToPrintWithIds(ids);
                }}
                className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-blue-700 rounded-lg hover:bg-blue-800 cursor-pointer transition-colors shadow-xs"
              >
                <Printer className="w-4 h-4" />
                Chuyển Qua In Ngay ({importResultBanner.importedIds.length} thẻ vừa import)
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={stats.selectedCount === 0 || isSubmitting}
                  onClick={() => handleConfirm(false)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Chỉ Import ({stats.selectedCount} dòng)
                </button>
                <button
                  type="button"
                  disabled={stats.selectedCount === 0 || isSubmitting}
                  onClick={() => handleConfirm(true)}
                  className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors shadow-xs"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Đang Import vào hệ thống...
                    </>
                  ) : (
                    <>
                      <Printer className="w-4 h-4" />
                      Import &amp; Chuyển Qua In Ngay ({stats.selectedCount} thẻ)
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
