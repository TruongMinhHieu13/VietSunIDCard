import React, { useState, useMemo, useRef } from 'react';
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
  Layers,
  Filter,
} from 'lucide-react';
import { Employee } from '../types';
import { compressImageTo3x4DataUrl } from './EmployeeManagementView';

export interface ParsedExcelRow {
  rowNumber: number;
  msnv: string;
  lastName?: string;
  firstName?: string;
  fullName: string;
  department: string;
  jobTitle?: string;
  joinDate: string;
  photoUrl?: string;
  status: 'valid_new' | 'valid_update' | 'error';
  errors: string[];
  existingEmployeeId?: string;
  selected: boolean;
}

interface RawExtractedRow {
  rowNumber: number;
  msnv: string;
  lastName: string;
  firstName: string;
  fullName: string;
  department: string;
  jobTitle: string;
  joinDate: string;
  isHiddenInExcel: boolean;
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

function cleanUnicodeStr(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val)
    .normalize('NFC')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripViAccents(val: unknown): string {
  return cleanUnicodeStr(val)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function formatExcelDate(val: unknown): string {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'number') {
    const parsed = XLSX.SSF.parse_date_code(val);
    if (parsed && parsed.y > 1900 && parsed.m >= 1 && parsed.d >= 1) {
      return `${String(parsed.d).padStart(2, '0')}/${String(parsed.m).padStart(2, '0')}/${parsed.y}`;
    }
    const utcDays = Math.floor(val - 25569);
    const dateInfo = new Date(utcDays * 86400 * 1000);
    if (!isNaN(dateInfo.getTime())) {
      const dd = String(dateInfo.getUTCDate()).padStart(2, '0');
      const mm = String(dateInfo.getUTCMonth() + 1).padStart(2, '0');
      const yyyy = dateInfo.getUTCFullYear();
      return `${dd}/${mm}/${yyyy}`;
    }
  }
  if (val instanceof Date && !isNaN(val.getTime())) {
    const dd = String(val.getDate()).padStart(2, '0');
    const mm = String(val.getMonth() + 1).padStart(2, '0');
    const yyyy = val.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  const str = cleanUnicodeStr(val);
  // Convert YYYY-MM-DD to DD/MM/YYYY if matched
  const isoMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[3].padStart(2, '0')}/${isoMatch[2].padStart(2, '0')}/${isoMatch[1]}`;
  }
  // Normalize D/M/YYYY to DD/MM/YYYY
  const dmyMatch = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmyMatch) {
    const yearStr = dmyMatch[3].length === 2 ? `20${dmyMatch[3]}` : dmyMatch[3];
    return `${dmyMatch[1].padStart(2, '0')}/${dmyMatch[2].padStart(2, '0')}/${yearStr}`;
  }
  return str;
}

function readCellText(worksheet: XLSX.WorkSheet, r: number, c: number): string {
  if (c < 0 || r < 0) return '';
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell = worksheet[addr] as XLSX.CellObject | undefined;
  if (!cell || cell.t === 'e' || cell.t === 'z') return '';
  if (cell.w !== undefined && String(cell.w).trim() !== '') {
    return cleanUnicodeStr(cell.w);
  }
  if (cell.v !== undefined && cell.v !== null) {
    return cleanUnicodeStr(cell.v);
  }
  return '';
}

function readCellDate(worksheet: XLSX.WorkSheet, r: number, c: number): string {
  if (c < 0 || r < 0) return '';
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell = worksheet[addr] as XLSX.CellObject | undefined;
  if (!cell || cell.t === 'e' || cell.t === 'z') return '';
  if (cell.t === 'n' && typeof cell.v === 'number') {
    return formatExcelDate(cell.v);
  }
  if (cell.t === 'd' && cell.v instanceof Date) {
    return formatExcelDate(cell.v);
  }
  if (cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== '') {
    return formatExcelDate(cell.v);
  }
  if (cell.w !== undefined && String(cell.w).trim() !== '') {
    return formatExcelDate(cell.w);
  }
  return '';
}

export function downloadSampleExcelTemplate() {
  // Exact 12-column (A -> L) structure matching VietSun HR file (Columns G -> L used for ID cards)
  const aoa: unknown[][] = [
    [
      'VIETSUN',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'DANH SÁCH CÁN BỘ CÔNG NHÂN VIÊN',
      '',
      '',
    ],
    [
      'STT',
      'ĐƠN VỊ',
      'Tình trạng',
      'KHỐI',
      'KÝ HIỆU PB',
      'PHÒNG BAN',
      'PHÒNG BAN CON',
      'MSNV',
      'HỌ',
      'TÊN',
      'CÔNG VIỆC',
      'NGÀY VÀO',
    ],
    [
      'No',
      'Donvi',
      'Tinhtrang',
      '',
      'Tinhtrang',
      'Bophan5',
      'Bophancon6',
      'Manhanvien',
      'Ho',
      'Ten',
      'Congviec',
      'Ngayvaocty',
    ],
    [1, 'XMAY 03', 'LV', 'GTSX', 'P8', 'Tổ Kỹ thuật triển khai', 'Tổ Triển khai sản xuất', '00441', 'Dương Minh', 'Tuấn', 'Nhân viên Kỹ thuật triển khai', '15/08/2025'],
    [2, 'XMAY 03', 'LV', 'TTSX', 'P14', 'Tổ Cơ động', 'Tổ Cơ động', '91051', 'Lâm Thị Thu', 'Thuỷ', 'Công nhân vận hành máy may công nghiệp', '02/11/2026'],
    [3, 'XMAY 03', 'LV', 'GTSX', 'P7', 'Phòng quản lý chất lượng', 'Tổ QC', '91052', 'Nguyễn Thị Hồng', 'Linh', 'Công nhân QC ENDLINE', '02/11/2026'],
    [4, 'XMAY 03', 'LV', 'TTSX', 'P15', 'Chuyền may', 'Chuyền may 01-02', '91053', 'Phạm Thị Bích', 'Hoa', 'Công nhân vận hành máy may công nghiệp', '02/11/2026'],
    [5, 'XMAY 03', 'LV', 'TTSX', 'P15', 'Chuyền may', 'Chuyền may 11-02', '91054', 'Thị', 'Minh', 'Công nhân vận hành máy may công nghiệp', '04/11/2026'],
    [6, 'XMAY 03', 'LV', 'GTSX', 'P16', 'Tổ Hoàn Thành', 'Nhóm hoàn thành', '91055', 'Nguyễn Văn', 'Hải', 'Công nhân đóng thùng', '04/11/2026'],
    [7, 'XMAY 03', 'LV', 'TTSX', 'P15', 'Chuyền may', 'Chuyền may 04-02', '91056', 'Nguyễn Minh', 'Trí', 'Công nhân ủi', '04/11/2026'],
    [8, 'XMAY 03', 'LV', 'GTSX', 'P16', 'Tổ Hoàn Thành', 'Nhóm gấp xếp', '91058', 'Trần Thị Hồng', 'Thắm', 'Công nhân gấp xếp', '11/07/2026'],
    [9, 'XMAY 03', 'LV', 'TTSX', 'P15', 'Chuyền may', 'Chuyền may 12-02', '91059', 'Nguyễn Thị Ánh', 'Hội', 'Công nhân vận hành máy may công nghiệp', '09/11/2026'],
    [10, 'XMAY 03', 'LV', 'TTSX', 'P15', 'Chuyền may', 'Chuyền may 12-02', '91060', 'Trương Thị Phương', 'Thảo', 'Công nhân vận hành máy may công nghiệp', '10/11/2026'],
    [11, 'XMAY 03', 'LV', 'Văn phòng', 'P6', 'Phòng Bảo trì vận hành', 'BP. Bảo trì vận hành', '91061', 'Phạm Văn', 'Việt', 'Nhân viên bảo trì vận hành', '10/11/2026'],
    [12, 'XMAY 03', 'LV', 'TTSX', 'P14', 'Tổ Cơ động', 'Tổ Cơ động', '91062', 'Lê Hồng', 'Nhung', 'Công nhân vận hành máy may công nghiệp', '12/11/2026'],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet['!cols'] = [
    { wch: 6 },  // A: STT
    { wch: 11 }, // B: ĐƠN VỊ
    { wch: 10 }, // C: Tình trạng
    { wch: 10 }, // D: KHỐI
    { wch: 12 }, // E: KÝ HIỆU PB
    { wch: 24 }, // F: PHÒNG BAN
    { wch: 24 }, // G: PHÒNG BAN CON
    { wch: 12 }, // H: MSNV
    { wch: 20 }, // I: HỌ
    { wch: 10 }, // J: TÊN
    { wch: 36 }, // K: CÔNG VIỆC
    { wch: 14 }, // L: NGÀY VÀO
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'DanhSachNhanVien');
  XLSX.writeFile(workbook, 'File_Mau_Import_Nhan_Vien_VietSun.xlsx');
}

export function exportEmployeesToExcel(employees: Employee[]) {
  const rows = employees.map((emp, idx) => {
    const parts = emp.fullName.trim().split(/\s+/);
    const ten = parts.length > 1 ? parts[parts.length - 1] : emp.fullName;
    const ho = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
    return {
      STT: idx + 1,
      'ĐƠN VỊ': 'XMAY 03',
      'Tình trạng': 'LV',
      KHỐI: '',
      'KÝ HIỆU PB': '',
      'PHÒNG BAN': emp.department,
      'PHÒNG BAN CON': emp.department,
      MSNV: emp.msnv,
      HỌ: ho,
      TÊN: ten,
      'CÔNG VIỆC': '',
      'NGÀY VÀO': emp.joinDate,
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 6 },
    { wch: 11 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 24 },
    { wch: 24 },
    { wch: 12 },
    { wch: 20 },
    { wch: 10 },
    { wch: 30 },
    { wch: 14 },
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const workbookRef = useRef<XLSX.WorkBook | null>(null);

  const [fileName, setFileName] = useState<string>('');
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheetName, setSelectedSheetName] = useState<string>('');
  const [detectedColumnsNote, setDetectedColumnsNote] = useState<string>('');
  const [onlyVisibleExcelRows, setOnlyVisibleExcelRows] = useState<boolean>(true);
  const [isParsingFile, setIsParsingFile] = useState<boolean>(false);

  const [allExtractedRows, setAllExtractedRows] = useState<RawExtractedRow[]>([]);
  const [rowPhotos, setRowPhotos] = useState<Record<number, string>>({});
  const [importMode, setImportMode] = useState<'add_only' | 'upsert'>('upsert');
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

  const hiddenRowCountInSheet = useMemo(() => {
    return allExtractedRows.filter((r) => r.isHiddenInExcel).length;
  }, [allExtractedRows]);

  const activeRawRows = useMemo(() => {
    const visibleOnly = allExtractedRows.filter((r) => !r.isHiddenInExcel);
    // If user enabled onlyVisibleExcelRows and there is at least 1 visible row, use visible rows
    if (onlyVisibleExcelRows && visibleOnly.length > 0) {
      return visibleOnly;
    }
    return allExtractedRows;
  }, [allExtractedRows, onlyVisibleExcelRows]);

  // Re-evaluate rows whenever activeRawRows, importMode, or existingEmployees change
  const evaluatedRows: ParsedExcelRow[] = useMemo(() => {
    const seenInFile = new Map<string, number>();

    return activeRawRows.map((row) => {
      const errors: string[] = [];
      const msnvClean = row.msnv.trim();
      const nameClean = row.fullName.trim();
      const deptClean = row.department.trim();
      const dateClean = row.joinDate.trim();

      if (!msnvClean) errors.push('Thiếu MSNV (Cột H)');
      if (!nameClean) errors.push('Thiếu Họ / Tên (Cột I, J)');
      if (!deptClean) errors.push('Thiếu Phòng ban con (Cột G)');
      if (!dateClean) errors.push('Thiếu Ngày vào (Cột L)');

      if (msnvClean.length > 50) errors.push('MSNV vượt quá 50 ký tự');
      if (nameClean.length > 120) errors.push('Họ và tên vượt quá 120 ký tự');
      if (deptClean.length > 120) errors.push('Phòng ban con vượt quá 120 ký tự');
      if (dateClean.length > 30) errors.push('Ngày vào vượt quá 30 ký tự');

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
        errors.push(`Trùng MSNV "${msnvClean}" đã tồn tại (${existingEmp.fullName})`);
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
        lastName: row.lastName,
        firstName: row.firstName,
        fullName: nameClean,
        department: deptClean,
        jobTitle: row.jobTitle,
        joinDate: dateClean,
        photoUrl: rowPhotos[row.rowNumber] || existingEmp?.photoUrl || '',
        status,
        errors,
        existingEmployeeId: existingEmp?.id,
        selected: !isError && !deselectedRowNums.has(row.rowNumber),
      };
    });
  }, [activeRawRows, importMode, existingMap, deselectedRowNums, rowPhotos]);

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

  const parseSheetFromWorkbook = (wb: XLSX.WorkBook, sheetName: string) => {
    const worksheet = wb.Sheets[sheetName];
    if (!worksheet || !worksheet['!ref']) {
      setParseError(`Sheet "${sheetName}" không có dữ liệu hoặc để trống.`);
      setAllExtractedRows([]);
      return;
    }

    const range = XLSX.utils.decode_range(worksheet['!ref']);
    const maxScanHeaderRow = Math.min(range.e.r, 60);
    const maxScanCol = Math.min(range.e.c, 35);

    // Default column mapping: Exact Excel Columns G -> L (0-based indices: G=6, H=7, I=8, J=9, K=10, L=11)
    let colDept = 6;   // Cột G: PHÒNG BAN CON (Bophancon6)
    let colMsnv = 7;   // Cột H: MSNV (Manhanvien)
    let colHo = 8;     // Cột I: HỌ (Ho)
    let colTen = 9;    // Cột J: TÊN (Ten)
    let colFullName = -1;
    let colJob = 10;   // Cột K: CÔNG VIỆC (Congviec)
    let colDate = 11;  // Cột L: NGÀY VÀO (Ngayvaocty)
    let dataStartRow = 0;

    // Scan first 60 rows to find the Vietnamese header row or sub-header row (Bophancon6 | Manhanvien | Ho | Ten | Congviec | Ngayvaocty)
    let headerRowIdx = -1;
    for (let r = 0; r <= maxScanHeaderRow; r++) {
      let rowHasMsnv = false;
      let rowHasDeptOrName = false;
      for (let c = 0; c <= maxScanCol; c++) {
        const s = stripViAccents(readCellText(worksheet, r, c));
        if (!s) continue;
        if (
          s === 'msnv' ||
          s.startsWith('manh') ||
          s.includes('ma so nhan vien') ||
          s === 'ma nv'
        ) {
          rowHasMsnv = true;
        }
        if (
          s.includes('phong ban') ||
          s.includes('bophan') ||
          s.includes('bo phan') ||
          s === 'ho' ||
          s === 'ho va ten'
        ) {
          rowHasDeptOrName = true;
        }
      }
      if (rowHasMsnv && rowHasDeptOrName) {
        headerRowIdx = r;
        break;
      }
    }

    if (headerRowIdx !== -1) {
      const hRow: string[] = [];
      const nextRow: string[] = [];
      for (let c = 0; c <= maxScanCol; c++) {
        hRow[c] = stripViAccents(readCellText(worksheet, headerRowIdx, c));
        nextRow[c] = stripViAccents(readCellText(worksheet, headerRowIdx + 1, c));
      }

      // Check if headerRowIdx + 1 is the English code sub-header row (No | Donvi | ... | Bophancon6 | Manhanvien | Ho | Ten | Congviec | Ngayvaocty)
      const isNextRowSubHeader = nextRow.some(
        (s) =>
          s.includes('bophan') ||
          s.startsWith('manh') ||
          s.includes('ngayvao') ||
          s === 'congviec' ||
          s.startsWith('donvi') ||
          s.startsWith('tinhtrang')
      );

      dataStartRow = isNextRowSubHeader ? headerRowIdx + 2 : headerRowIdx + 1;

      // Check if Columns G -> L (indices 6 -> 11) match the standard VietSun HR layout
      const isColGtoL =
        hRow[7] === 'msnv' ||
        nextRow[7]?.startsWith('manh') ||
        hRow[6]?.includes('phong ban con') ||
        nextRow[6]?.includes('bophancon');

      if (isColGtoL) {
        colDept = 6;
        colMsnv = 7;
        colHo = 8;
        colTen = 9;
        colFullName = -1;
        colJob = 10;
        colDate = 11;
      } else {
        // Find where MSNV is located
        const findCol = (pred: (s: string) => boolean): number => {
          for (let c = 0; c <= maxScanCol; c++) {
            if (pred(hRow[c] || '')) return c;
          }
          if (isNextRowSubHeader) {
            for (let c = 0; c <= maxScanCol; c++) {
              if (pred(nextRow[c] || '')) return c;
            }
          }
          return -1;
        };

        const foundDeptSub = findCol(
          (s) => s.includes('phong ban con') || s.includes('bophancon')
        );
        const foundMsnv = findCol(
          (s) => s === 'msnv' || s.startsWith('manh') || s.includes('ma so') || s === 'ma nv'
        );
        const foundHo = findCol((s) => s === 'ho' || s === 'ho dem');
        const foundTen = findCol((s) => s === 'ten');
        const foundFullName = findCol(
          (s) => s.includes('ho va ten') || s === 'ho ten'
        );
        const foundJob = findCol(
          (s) => s.includes('cong viec') || s.includes('congviec')
        );
        const foundDate = findCol(
          (s) => s.includes('ngay vao') || s.includes('ngayvao')
        );

        // If PHÒNG BAN CON and MSNV are adjacent (like G & H shifted to another start column), lock the 6-column block G..L relative to foundDeptSub or foundMsnv!
        if (foundMsnv !== -1 && foundHo === foundMsnv + 1 && foundTen === foundMsnv + 2) {
          colDept = foundDeptSub !== -1 ? foundDeptSub : Math.max(0, foundMsnv - 1);
          colMsnv = foundMsnv;
          colHo = foundMsnv + 1;
          colTen = foundMsnv + 2;
          colFullName = -1;
          colJob = foundJob !== -1 ? foundJob : foundMsnv + 3;
          colDate = foundDate !== -1 ? foundDate : foundMsnv + 4;
        } else {
          const foundDeptAny = findCol(
            (s) => s.includes('bo phan') || s.includes('phong ban') || s.includes('bophan')
          );
          if (foundDeptSub !== -1) colDept = foundDeptSub;
          else if (foundDeptAny !== -1) colDept = foundDeptAny;

          if (foundMsnv !== -1) colMsnv = foundMsnv;
          if (foundHo !== -1 && foundTen !== -1) {
            colHo = foundHo;
            colTen = foundTen;
            colFullName = -1;
          } else if (foundFullName !== -1) {
            colFullName = foundFullName;
            colHo = -1;
            colTen = -1;
          }
          if (foundJob !== -1) colJob = foundJob;
          if (foundDate !== -1) colDate = foundDate;
        }
      }
    }

    const colLetter = (c: number) => (c >= 0 ? XLSX.utils.encode_col(c) : '?');
    setDetectedColumnsNote(
      colFullName >= 0
        ? `Sheet "${sheetName}" · Cột Bộ phận: ${colLetter(colDept)} · MSNV: ${colLetter(colMsnv)} · Họ tên: ${colLetter(colFullName)} · Ngày vào: ${colLetter(colDate)}`
        : `Sheet "${sheetName}" · Cột ${colLetter(colDept)} (Phòng ban con) · Cột ${colLetter(colMsnv)} (MSNV) · Cột ${colLetter(colHo)} (Họ) · Cột ${colLetter(colTen)} (Tên) · Cột ${colLetter(colJob)} (Công việc) · Cột ${colLetter(colDate)} (Ngày vào)`
    );

    const rowProps = worksheet['!rows'] || [];
    const extracted: RawExtractedRow[] = [];
    let emptyStreak = 0;
    const maxRow = Math.min(range.e.r, 20000);

    for (let r = dataStartRow; r <= maxRow; r++) {
      const deptVal = readCellText(worksheet, r, colDept);
      const msnvVal = readCellText(worksheet, r, colMsnv);
      const hoVal = colHo >= 0 ? readCellText(worksheet, r, colHo) : '';
      const tenVal = colTen >= 0 ? readCellText(worksheet, r, colTen) : '';
      const fullVal =
        colFullName >= 0
          ? readCellText(worksheet, r, colFullName)
          : [hoVal, tenVal].filter(Boolean).join(' ').trim();
      const jobVal = readCellText(worksheet, r, colJob);
      const dateVal = readCellDate(worksheet, r, colDate);

      if (!msnvVal && !fullVal && !deptVal && !dateVal) {
        emptyStreak++;
        if (emptyStreak > 250) break;
        continue;
      }
      emptyStreak = 0;

      // Skip repeated header / sub-header / filter code rows
      const msnvCheck = stripViAccents(msnvVal);
      const deptCheck = stripViAccents(deptVal);
      const hoCheck = stripViAccents(hoVal);
      if (
        msnvCheck === 'msnv' ||
        msnvCheck.startsWith('manh') ||
        deptCheck === 'phong ban con' ||
        deptCheck.startsWith('bophancon') ||
        (hoCheck === 'ho' && stripViAccents(tenVal) === 'ten')
      ) {
        continue;
      }

      // Also skip title rows above table where both MSNV and Name are empty
      if (!msnvVal && !fullVal) {
        continue;
      }

      let splitHo = hoVal;
      let splitTen = tenVal;
      if (!splitHo && !splitTen && fullVal) {
        const parts = fullVal.split(/\s+/);
        splitTen = parts.length > 1 ? parts[parts.length - 1] : fullVal;
        splitHo = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
      }

      const isHidden = Boolean(rowProps[r]?.hidden);

      extracted.push({
        rowNumber: r + 1,
        msnv: msnvVal,
        lastName: splitHo,
        firstName: splitTen,
        fullName: fullVal,
        department: deptVal,
        jobTitle: jobVal,
        joinDate: dateVal,
        isHiddenInExcel: isHidden,
      });
    }

    if (extracted.length === 0) {
      setParseError(
        `Sheet "${sheetName}" không có dòng dữ liệu nhân viên nào tại các cột G -> L (PHÒNG BAN CON, MSNV, HỌ, TÊN, CÔNG VIỆC, NGÀY VÀO). Nếu dữ liệu nằm ở Sheet khác, vui lòng chọn Sheet tương ứng bên dưới.`
      );
      setAllExtractedRows([]);
      return;
    }

    setParseError(null);
    setAllExtractedRows(extracted);
  };

  const processExcelFile = (file: File) => {
    setIsParsingFile(true);
    setParseError(null);
    setImportResultBanner(null);
    setFileName(file.name);
    setDeselectedRowNums(new Set());
    setRowPhotos({});

    const reader = new FileReader();
    reader.onerror = () => {
      setIsParsingFile(false);
      setParseError('Không thể đọc file từ máy tính. Vui lòng thử chọn lại file.');
    };
    reader.onload = (evt) => {
      try {
        const data = evt.target?.result;
        const wb = XLSX.read(data, { type: 'array' });
        workbookRef.current = wb;

        const allSheets = wb.SheetNames || [];
        setSheetNames(allSheets);

        if (allSheets.length === 0) {
          setParseError('File Excel không có Sheet nào.');
          setAllExtractedRows([]);
          setIsParsingFile(false);
          return;
        }

        // Smartly pick the best Sheet: prefer the sheet that contains PHÒNG BAN CON / Bophancon6 & MSNV / Manhanvien, and prefer Excel's activeTab
        const wbProps = wb.Workbook as
          | {
              WBView?: Array<{ activeTab?: number }>;
              Sheets?: Array<{ Hidden?: number }>;
            }
          | undefined;
        const activeTabIdx = wbProps?.WBView?.[0]?.activeTab ?? 0;
        const sheetMeta = wbProps?.Sheets || [];

        let bestSheet = allSheets[activeTabIdx] || allSheets[0];
        let bestScore = -1;

        allSheets.forEach((sName, idx) => {
          const isHiddenSheet = sheetMeta[idx]?.Hidden === 1 || sheetMeta[idx]?.Hidden === 2;
          if (isHiddenSheet && allSheets.length > 1) return;

          const ws = wb.Sheets[sName];
          if (!ws || !ws['!ref']) return;
          const rRange = XLSX.utils.decode_range(ws['!ref']);
          const scanR = Math.min(rRange.e.r, 40);
          const scanC = Math.min(rRange.e.c, 20);

          let score = idx === activeTabIdx ? 5 : 0;
          for (let r = 0; r <= scanR; r++) {
            for (let c = 0; c <= scanC; c++) {
              const txt = stripViAccents(readCellText(ws, r, c));
              if (!txt) continue;
              if (txt === 'msnv' || txt.startsWith('manh')) score += 20;
              if (txt.includes('phong ban con') || txt.includes('bophancon')) score += 30;
              if (txt.includes('ngay vao') || txt.includes('ngayvaocty')) score += 15;
              if (txt.includes('danh sach can bo cong nhan vien')) score += 15;
            }
          }

          if (score > bestScore) {
            bestScore = score;
            bestSheet = sName;
          }
        });

        setSelectedSheetName(bestSheet);
        parseSheetFromWorkbook(wb, bestSheet);
      } catch (err) {
        setParseError(
          err instanceof Error
            ? `Không thể đọc file Excel: ${err.message}`
            : 'Định dạng file Excel không hợp lệ.'
        );
        setAllExtractedRows([]);
      } finally {
        setIsParsingFile(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input value immediately so selecting the same file again ALWAYS fires onChange
    e.target.value = '';
    if (!file) return;
    processExcelFile(file);
  };

  const handleSheetChange = (newSheetName: string) => {
    setSelectedSheetName(newSheetName);
    setDeselectedRowNums(new Set());
    if (workbookRef.current) {
      parseSheetFromWorkbook(workbookRef.current, newSheetName);
    }
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
    setSheetNames([]);
    setSelectedSheetName('');
    setDetectedColumnsNote('');
    setAllExtractedRows([]);
    setRowPhotos({});
    setDeselectedRowNums(new Set());
    setImportResultBanner(null);
    setParseError(null);
    workbookRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
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
                Import Danh Sách Nhân Viên Từ File Excel (Cột G → L)
              </h2>
              <p className="text-xs text-blue-100">
                Tự động đọc chuẩn từ Cột G → L: PHÒNG BAN CON (G) · MSNV (H) · HỌ (I) · TÊN (J) · CÔNG VIỆC (K) · NGÀY VÀO (L)
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
                  1. Chọn file Excel nhân sự (.xlsx, .xls) — Tự động lấy Cột G → L
                </span>
                <button
                  type="button"
                  onClick={downloadSampleExcelTemplate}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Tải File Excel Mẫu Chuẩn (Cột A → L)
                </button>
              </div>

              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const droppedFile = e.dataTransfer.files?.[0];
                  if (droppedFile) {
                    processExcelFile(droppedFile);
                  }
                }}
                className="flex items-center justify-center gap-3 border-2 border-dashed border-blue-400 bg-white hover:bg-blue-50/50 rounded-lg p-4 cursor-pointer transition-colors"
              >
                {isParsingFile ? (
                  <RefreshCw className="w-5 h-5 text-blue-600 animate-spin shrink-0" />
                ) : (
                  <Upload className="w-5 h-5 text-blue-600 shrink-0" />
                )}
                <div className="text-left flex-1">
                  <div className="text-sm font-semibold text-slate-800">
                    {isParsingFile
                      ? 'Đang đọc dữ liệu từ file Excel...'
                      : fileName
                        ? `Đã tải file: ${fileName} (Bấm hoặc kéo thả để chọn lại file)`
                        : 'Bấm vào đây hoặc kéo thả file Excel (.xlsx, .xls) từ máy tính'}
                  </div>
                  <div className="text-xs text-slate-500">
                    Đọc trực tiếp Cột G → L: G (Phòng ban con) · H (MSNV) · I (Họ) · J (Tên) · K (Công việc) · L (Ngày vào)
                  </div>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.xlsm,.xlsb,.csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              {/* Sheet Selector & Column Mapping Status */}
              {(sheetNames.length > 0 || detectedColumnsNote) && (
                <div className="flex flex-wrap items-center justify-between gap-2 bg-blue-50/70 border border-blue-200 rounded-lg px-3 py-2 text-xs">
                  {sheetNames.length > 1 ? (
                    <div className="flex items-center gap-2">
                      <Layers className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                      <span className="font-semibold text-slate-700">Chọn Sheet cần lấy:</span>
                      <select
                        value={selectedSheetName}
                        onChange={(e) => handleSheetChange(e.target.value)}
                        className="px-2.5 py-1 text-xs font-bold text-blue-800 bg-white border border-blue-300 rounded-md cursor-pointer"
                      >
                        {sheetNames.map((sName) => (
                          <option key={sName} value={sName}>
                            Sheet: {sName}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-blue-800 font-semibold">
                      <Layers className="w-3.5 h-3.5 shrink-0" />
                      <span>{detectedColumnsNote}</span>
                    </div>
                  )}

                  {hiddenRowCountInSheet > 0 && (
                    <label className="inline-flex items-center gap-1.5 font-semibold text-amber-800 bg-amber-100/80 border border-amber-300 px-2.5 py-1 rounded-md cursor-pointer">
                      <input
                        type="checkbox"
                        checked={onlyVisibleExcelRows}
                        onChange={(e) => setOnlyVisibleExcelRows(e.target.checked)}
                        className="accent-blue-700"
                      />
                      <Filter className="w-3 h-3" />
                      <span>
                        Chỉ lấy dòng đang lọc/hiển thị (Bỏ qua {hiddenRowCountInSheet} dòng ẩn trong Excel)
                      </span>
                    </label>
                  )}
                </div>
              )}
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

              {/* Data Table (Columns G -> L matching VietSun HR Excel sheet) */}
              <div className="border border-slate-200 rounded-lg overflow-hidden max-h-[380px] overflow-x-auto overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-100 text-slate-700 sticky top-0 z-10 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-2.5 w-10 text-center">Chọn</th>
                      <th className="py-2.5 px-2.5 w-14 font-mono-num">Dòng</th>
                      <th className="py-2.5 px-2.5 w-18 text-center">Ảnh 25×35</th>
                      <th className="py-2.5 px-2.5">
                        <span className="block font-bold text-slate-900">PHÒNG BAN CON (Cột G)</span>
                        <span className="text-[10px] font-normal text-slate-500 font-mono-num">Bophancon6</span>
                      </th>
                      <th className="py-2.5 px-2.5 w-24">
                        <span className="block font-bold text-slate-900">MSNV (Cột H)</span>
                        <span className="text-[10px] font-normal text-slate-500 font-mono-num">Manhanvien</span>
                      </th>
                      <th className="py-2.5 px-2.5">
                        <span className="block font-bold text-slate-900">HỌ (Cột I)</span>
                        <span className="text-[10px] font-normal text-slate-500 font-mono-num">Ho</span>
                      </th>
                      <th className="py-2.5 px-2.5 w-20">
                        <span className="block font-bold text-slate-900">TÊN (Cột J)</span>
                        <span className="text-[10px] font-normal text-slate-500 font-mono-num">Ten</span>
                      </th>
                      <th className="py-2.5 px-2.5">
                        <span className="block font-bold text-slate-900">CÔNG VIỆC (Cột K)</span>
                        <span className="text-[10px] font-normal text-slate-500 font-mono-num">Congviec</span>
                      </th>
                      <th className="py-2.5 px-2.5 w-28">
                        <span className="block font-bold text-slate-900">NGÀY VÀO (Cột L)</span>
                        <span className="text-[10px] font-normal text-slate-500 font-mono-num">Ngayvaocty</span>
                      </th>
                      <th className="py-2.5 px-2.5 w-32">Trạng thái</th>
                      <th className="py-2.5 px-2.5">Ghi chú / Kiểm tra</th>
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
                          <td className="py-2 px-2.5 text-center">
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
                          <td className="py-2 px-2.5 font-mono-num text-slate-500">
                            #{row.rowNumber}
                          </td>
                          <td className="py-1.5 px-2.5 text-center">
                            {!isError && (
                              <label
                                className="w-8 h-10 rounded border border-slate-300 bg-white overflow-hidden inline-flex flex-col items-center justify-center cursor-pointer hover:border-blue-600"
                                title="Bấm để chọn ảnh 25×35mm cho dòng này"
                              >
                                {row.photoUrl ? (
                                  <img
                                    src={row.photoUrl}
                                    alt={row.fullName}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover object-top"
                                  />
                                ) : (
                                  <div className="flex flex-col items-center justify-center text-blue-600">
                                    <Camera className="w-3 h-3" />
                                    <span className="text-[7.5px] font-bold leading-none mt-0.5">
                                      25×35
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
                          <td className="py-2 px-2.5 text-slate-800 font-medium">
                            {row.department || <span className="text-red-500 italic">(Trống)</span>}
                          </td>
                          <td className="py-2 px-2.5 font-mono-num font-bold text-slate-900">
                            {row.msnv || <span className="text-red-500 italic">(Trống)</span>}
                          </td>
                          <td className="py-2 px-2.5 text-slate-800">
                            {row.lastName || <span className="text-slate-400 italic">—</span>}
                          </td>
                          <td className="py-2 px-2.5 font-bold text-slate-900">
                            {row.firstName || <span className="text-red-500 italic">(Trống)</span>}
                          </td>
                          <td className="py-2 px-2.5 text-slate-600">
                            {row.jobTitle || <span className="text-slate-400 italic">—</span>}
                          </td>
                          <td className="py-2 px-2.5 font-mono-num text-slate-800 font-medium">
                            {row.joinDate || <span className="text-red-500 italic">(Trống)</span>}
                          </td>
                          <td className="py-2 px-2.5 font-semibold">
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
                          <td className="py-2 px-2.5">
                            {isError ? (
                              <span className="text-red-600 font-medium">
                                {row.errors.join(' · ')}
                              </span>
                            ) : row.status === 'valid_update' ? (
                              <span className="text-blue-700">
                                Cập nhật thẻ: <strong>{row.fullName}</strong> ({row.msnv})
                              </span>
                            ) : (
                              <span className="text-emerald-700">
                                In trên thẻ: <strong>{row.fullName.toUpperCase()}</strong>
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
