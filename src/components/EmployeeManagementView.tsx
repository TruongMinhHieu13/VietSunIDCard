import React, { useState, useMemo } from 'react';
import {
  UserPlus,
  FileSpreadsheet,
  Download,
  Printer,
  Search,
  Edit3,
  Trash2,
  Eye,
  CheckSquare,
  Square,
  AlertCircle,
  Upload,
  X,
  Database,
  Calendar,
  Camera,
  CheckCircle2,
  ScanFace,
} from 'lucide-react';
import { CardTemplate, Employee } from '../types';
import { IdCardPreview } from './IdCardPreview';
import {
  downloadSampleExcelTemplate,
  exportEmployeesToExcel,
} from './ExcelImportModal';
import {
  autoCropFileWithFaceAI,
  matchEmployeeByPhotoFileName,
} from '../utils/faceDetectionCrop';
import { DirectMsnvDropModal, FaceCropModal } from './FaceCropStudioView';

export async function compressImageTo3x4DataUrl(file: File): Promise<string> {
  const { dataUrl } = await autoCropFileWithFaceAI(file, 3 / 4, 354);
  return dataUrl;
}

export function parseDateToUtcTimestamp(dateStr: string): number | null {
  if (!dateStr) return null;
  const s = dateStr.trim();
  // Match DD/MM/YYYY or DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const d = parseInt(dmy[1], 10);
    const m = parseInt(dmy[2], 10);
    const y = parseInt(dmy[3], 10);
    return Date.UTC(y, m - 1, d);
  }
  // Match YYYY-MM-DD or YYYY/MM/DD
  const ymd = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (ymd) {
    const y = parseInt(ymd[1], 10);
    const m = parseInt(ymd[2], 10);
    const d = parseInt(ymd[3], 10);
    return Date.UTC(y, m - 1, d);
  }
  const parsed = Date.parse(s);
  return isNaN(parsed) ? null : parsed;
}

interface EmployeeManagementViewProps {
  employees: Employee[];
  selectedTemplate: CardTemplate;
  selectedEmployeeIds: Set<string>;
  onChangeSelectedIds: (ids: Set<string>) => void;
  onAddEmployee: (data: {
    msnv: string;
    fullName: string;
    department: string;
    joinDate: string;
    photoUrl: string;
  }) => Promise<string | void>;
  onUpdateEmployee: (
    id: string,
    data: {
      msnv: string;
      fullName: string;
      department: string;
      joinDate: string;
      photoUrl: string;
    }
  ) => Promise<void>;
  onDeleteEmployee: (id: string) => Promise<void>;
  onBatchDeleteEmployees: (ids: string[]) => Promise<void>;
  onOpenImportModal: () => void;
  onGoToBatchPrint: () => void;
  onOpenPrintDialog: (employeeIds?: string[]) => void;
  onSeedSampleEmployees: () => Promise<void>;
}

export const EmployeeManagementView: React.FC<EmployeeManagementViewProps> = ({
  employees,
  selectedTemplate,
  selectedEmployeeIds,
  onChangeSelectedIds,
  onAddEmployee,
  onUpdateEmployee,
  onDeleteEmployee,
  onBatchDeleteEmployees,
  onOpenImportModal,
  onGoToBatchPrint,
  onOpenPrintDialog,
  onSeedSampleEmployees,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [printStatusFilter, setPrintStatusFilter] = useState<'ALL' | 'PRINTED' | 'UNPRINTED'>('ALL');
  const [joinDateFrom, setJoinDateFrom] = useState('');
  const [joinDateTo, setJoinDateTo] = useState('');

  // Add/Edit Modal State
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [msnv, setMsnv] = useState('');
  const [fullName, setFullName] = useState('');
  const [department, setDepartment] = useState('');
  const [joinDate, setJoinDate] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadingPhotoEmpId, setUploadingPhotoEmpId] = useState<string | null>(null);
  const [bulkUploadProgress, setBulkUploadProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [photoStatusBanner, setPhotoStatusBanner] = useState<string | null>(null);

  // Quick Card Preview Modal
  const [previewEmployee, setPreviewEmployee] = useState<Employee | null>(null);

  // Interactive AI Face Cropper Modal State
  const [faceCropEmployee, setFaceCropEmployee] = useState<Employee | null>(null);
  const [isFaceCropModalOpen, setIsFaceCropModalOpen] = useState(false);
  const [isDirectMsnvModalOpen, setIsDirectMsnvModalOpen] = useState(false);

  // Delete Confirmation Modal
  const [deletingEmployee, setDeletingEmployee] = useState<Employee | null>(null);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);

  const departments = useMemo(() => {
    const set = new Set<string>();
    employees.forEach((emp) => {
      if (emp.department) set.add(emp.department);
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
      const matchPrinted =
        printStatusFilter === 'ALL' ||
        (printStatusFilter === 'PRINTED' && emp.printCount > 0) ||
        (printStatusFilter === 'UNPRINTED' && (!emp.printCount || emp.printCount === 0));

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

      return matchQuery && matchDept && matchPrinted && matchJoinDate;
    });
  }, [employees, searchQuery, deptFilter, printStatusFilter, joinDateFrom, joinDateTo]);

  const openAddModal = () => {
    setEditingEmployee(null);
    setMsnv('');
    setFullName('');
    setDepartment(departments[0] || 'Bảo trì vận hành');
    setJoinDate('02/10/2026');
    setPhotoUrl('');
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEditModal = (emp: Employee) => {
    setEditingEmployee(emp);
    setMsnv(emp.msnv);
    setFullName(emp.fullName);
    setDepartment(emp.department);
    setJoinDate(emp.joinDate);
    setPhotoUrl(emp.photoUrl);
    setFormError(null);
    setIsFormOpen(true);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageTo3x4DataUrl(file);
      setPhotoUrl(compressed);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Lỗi tải ảnh 3×4');
    } finally {
      e.target.value = '';
    }
  };

  // Direct 1-click 3x4 photo upload for a specific employee right from the table or preview modal
  const handleDirectEmployeePhotoUpload = async (
    emp: Employee,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhotoEmpId(emp.id);
    try {
      const compressed = await compressImageTo3x4DataUrl(file);
      await onUpdateEmployee(emp.id, {
        msnv: emp.msnv,
        fullName: emp.fullName,
        department: emp.department,
        joinDate: emp.joinDate,
        photoUrl: compressed,
      });
      if (previewEmployee?.id === emp.id) {
        setPreviewEmployee({ ...emp, photoUrl: compressed });
      }
      setPhotoStatusBanner(
        `Đã cập nhật hình 3×4 cho nhân viên ${emp.fullName} (MSNV: ${emp.msnv})!`
      );
      setTimeout(() => setPhotoStatusBanner(null), 4000);
    } finally {
      setUploadingPhotoEmpId(null);
      e.target.value = '';
    }
  };

  const handleRemoveEmployeePhoto = async (emp: Employee) => {
    setUploadingPhotoEmpId(emp.id);
    try {
      await onUpdateEmployee(emp.id, {
        msnv: emp.msnv,
        fullName: emp.fullName,
        department: emp.department,
        joinDate: emp.joinDate,
        photoUrl: '',
      });
      if (previewEmployee?.id === emp.id) {
        setPreviewEmployee({ ...emp, photoUrl: '' });
      }
      setPhotoStatusBanner(
        `Đã xóa hình 3×4 của nhân viên ${emp.fullName} (MSNV: ${emp.msnv}).`
      );
      setTimeout(() => setPhotoStatusBanner(null), 3500);
    } finally {
      setUploadingPhotoEmpId(null);
    }
  };

  // Direct no-preview photo upload matching filename with MSNV (works for 1 or many files)
  const handleBulkPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setBulkUploadProgress({ current: 0, total: files.length });
    const matchedNames: string[] = [];
    const unmatchedFiles: string[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setBulkUploadProgress({ current: i + 1, total: files.length });
        const matchedEmp = matchEmployeeByPhotoFileName(file.name, employees);
        if (matchedEmp) {
          try {
            const compressed = await compressImageTo3x4DataUrl(file);
            await onUpdateEmployee(matchedEmp.id, {
              msnv: matchedEmp.msnv,
              fullName: matchedEmp.fullName,
              department: matchedEmp.department,
              joinDate: matchedEmp.joinDate,
              photoUrl: compressed,
            });
            matchedNames.push(`${matchedEmp.msnv} (${matchedEmp.fullName})`);
          } catch {
            unmatchedFiles.push(file.name);
          }
        } else {
          unmatchedFiles.push(file.name);
        }
      }

      if (matchedNames.length > 0) {
        const listStr = matchedNames.slice(0, 5).join(', ');
        const extra =
          matchedNames.length > 5 ? ` và ${matchedNames.length - 5} NV khác` : '';
        setPhotoStatusBanner(
          `Đã thêm thẳng ${matchedNames.length}/${files.length} ảnh 3×4 theo MSNV (không cần preview): ${listStr}${extra}!`
        );
      } else {
        setPhotoStatusBanner(
          `Không tìm thấy nhân viên có MSNV trùng tên file ảnh (${unmatchedFiles.slice(0, 3).join(', ')}). Mẹo: Đặt tên ảnh là MSNV (VD: 90993.jpg).`
        );
      }
      setTimeout(() => setPhotoStatusBanner(null), 6500);
    } finally {
      setBulkUploadProgress(null);
      e.target.value = '';
    }
  };

  const handleSaveEmployeeForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const msnvClean = msnv.trim();
    const nameClean = fullName.trim();
    const deptClean = department.trim();
    const dateClean = joinDate.trim();

    if (!msnvClean || !nameClean || !deptClean || !dateClean) {
      setFormError('Vui lòng nhập đầy đủ MSNV, Họ và tên, Bộ phận và Ngày vào làm.');
      return;
    }

    // Duplicate MSNV check
    const duplicate = employees.find(
      (emp) =>
        emp.msnv.trim().toLowerCase() === msnvClean.toLowerCase() &&
        emp.id !== editingEmployee?.id
    );
    if (duplicate) {
      setFormError(
        `Mã số nhân viên "${msnvClean}" đã tồn tại trong hệ thống (Nhân viên: ${duplicate.fullName} - ${duplicate.department}). Vui lòng kiểm tra lại!`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingEmployee) {
        await onUpdateEmployee(editingEmployee.id, {
          msnv: msnvClean,
          fullName: nameClean,
          department: deptClean,
          joinDate: dateClean,
          photoUrl,
        });
      } else {
        await onAddEmployee({
          msnv: msnvClean,
          fullName: nameClean,
          department: deptClean,
          joinDate: dateClean,
          photoUrl,
        });
      }
      setIsFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Lỗi khi lưu thông tin nhân viên.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleSelectOne = (id: string) => {
    const next = new Set(selectedEmployeeIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onChangeSelectedIds(next);
  };

  const isAllFilteredSelected =
    filteredEmployees.length > 0 &&
    filteredEmployees.every((emp) => selectedEmployeeIds.has(emp.id));

  const toggleSelectAllFiltered = () => {
    const next = new Set(selectedEmployeeIds);
    if (isAllFilteredSelected) {
      filteredEmployees.forEach((emp) => next.delete(emp.id));
    } else {
      filteredEmployees.forEach((emp) => next.add(emp.id));
    }
    onChangeSelectedIds(next);
  };

  return (
    <div className="space-y-5">
      {/* Top Action Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Danh Sách Nhân Viên ({employees.length} nhân sự)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Quản lý hồ sơ nhân viên, tải hình 3×4 trực tiếp cho từng nhân viên, nhập/xuất file Excel và in thẻ
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* IMPORT EXCEL BUTTON (Highlighted as requested) */}
          <button
            type="button"
            onClick={onOpenImportModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs cursor-pointer transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4" />
            IMPORT EXCEL
          </button>

          {/* AI 3x4 FACE CROP TOOL BUTTON */}
          <button
            type="button"
            onClick={() => {
              setFaceCropEmployee(employees[0] || null);
              setIsFaceCropModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg cursor-pointer transition-colors"
            title="Mở công cụ AI nhận diện khuôn mặt và cắt ảnh 3×4 từ bất kỳ tấm ảnh nào"
          >
            <ScanFace className="w-4 h-4" />
            Cắt Ảnh 3×4 Bằng AI
          </button>

          {/* DIRECT PHOTO UPLOAD BY MSNV WITHOUT PREVIEW (Opens Drag & Drop + Error Report Modal) */}
          {employees.length > 0 && (
            <button
              type="button"
              onClick={() => setIsDirectMsnvModalOpen(true)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                setIsDirectMsnvModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 rounded-lg cursor-pointer transition-colors"
              title="Bấm để mở khung kéo thả ảnh theo MSNV (không cần preview) và kiểm tra báo lỗi nếu hình sai"
            >
              <Camera className="w-3.5 h-3.5" />
              Thêm Ảnh Theo MSNV (Không Preview)
            </button>
          )}

          <button
            type="button"
            onClick={downloadSampleExcelTemplate}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Tải File Excel Mẫu
          </button>

          <button
            type="button"
            disabled={employees.length === 0}
            onClick={() => exportEmployeesToExcel(employees)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg disabled:opacity-50 cursor-pointer transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Xuất Ra Excel (.xlsx)
          </button>

          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Thêm Nhân Viên Mới
          </button>
        </div>
      </div>

      {photoStatusBanner && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{photoStatusBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setPhotoStatusBanner(null)}
            className="p-1 text-emerald-700 hover:bg-emerald-100 rounded cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Filter & Batch Action Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 flex-1">
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm kiếm theo Họ tên hoặc MSNV..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:border-blue-600"
              />
            </div>

            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-700"
            >
              <option value="ALL">Tất cả bộ phận ({departments.length})</option>
              {departments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>

            <select
              value={printStatusFilter}
              onChange={(e) =>
                setPrintStatusFilter(e.target.value as 'ALL' | 'PRINTED' | 'UNPRINTED')
              }
              className="px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-700"
            >
              <option value="ALL">Tất cả trạng thái in</option>
              <option value="PRINTED">Đã in thẻ</option>
              <option value="UNPRINTED">Chưa in thẻ</option>
            </select>

            {/* Join Date Range Filter (Lọc theo khoảng ngày vào làm) */}
            <div className="flex flex-wrap items-center gap-2 bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-xs">
              <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                <Calendar className="w-3.5 h-3.5 text-blue-600" />
                Ngày vào làm:
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500">Từ</span>
                <input
                  type="date"
                  value={joinDateFrom}
                  onChange={(e) => setJoinDateFrom(e.target.value)}
                  className="px-2 py-0.5 bg-white border border-slate-300 rounded font-mono-num text-slate-800 focus:outline-none focus:border-blue-600"
                  title="Từ ngày vào làm"
                />
                <span className="text-slate-500">đến</span>
                <input
                  type="date"
                  value={joinDateTo}
                  onChange={(e) => setJoinDateTo(e.target.value)}
                  className="px-2 py-0.5 bg-white border border-slate-300 rounded font-mono-num text-slate-800 focus:outline-none focus:border-blue-600"
                  title="Đến ngày vào làm"
                />
                {(joinDateFrom || joinDateTo) && (
                  <button
                    type="button"
                    onClick={() => {
                      setJoinDateFrom('');
                      setJoinDateTo('');
                    }}
                    className="p-1 text-red-600 hover:bg-red-50 rounded cursor-pointer"
                    title="Xóa lọc ngày vào làm"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Batch Selection Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {filteredEmployees.length > 0 &&
              (joinDateFrom || joinDateTo || deptFilter !== 'ALL' || searchQuery.trim()) && (
                <button
                  type="button"
                  onClick={() =>
                    onOpenPrintDialog(filteredEmployees.map((e) => e.id))
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  In {filteredEmployees.length} Thẻ Đang Lọc
                </button>
              )}

            {selectedEmployeeIds.size > 0 && (
              <>
                <span className="text-xs font-mono-num font-bold text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200">
                  Đã chọn {selectedEmployeeIds.size} thẻ
                </span>
                <button
                  type="button"
                  onClick={() => onOpenPrintDialog(Array.from(selectedEmployeeIds))}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  In {selectedEmployeeIds.size} Thẻ Đã Chọn
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmBatchDelete(true)}
                  className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Xóa mục chọn
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Employee Data Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {employees.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <Database className="w-10 h-10 text-blue-600 mx-auto" />
            <div className="text-base font-bold text-slate-900">
              Chưa có dữ liệu nhân viên trong hệ thống
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Bạn có thể bấm &quot;IMPORT EXCEL&quot; để tải danh sách nhân viên từ file Excel, thêm từng nhân viên mới, hoặc nạp bộ dữ liệu mẫu chuẩn của VIETSUN ĐỒNG NAI (bao gồm thẻ mẫu Trương Minh Hiếu - 90993).
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={onSeedSampleEmployees}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
              >
                <Database className="w-4 h-4" />
                Khởi Tạo Dữ Liệu Mẫu VIETSUN ĐỒNG NAI (8 Nhân viên)
              </button>
              <button
                type="button"
                onClick={onOpenImportModal}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Import Từ File Excel
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 w-10 text-center">
                    <button
                      type="button"
                      onClick={toggleSelectAllFiltered}
                      className="text-blue-600 cursor-pointer"
                      title="Chọn tất cả nhân viên đang hiển thị"
                    >
                      {isAllFilteredSelected ? (
                        <CheckSquare className="w-4 h-4" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-400" />
                      )}
                    </button>
                  </th>
                  <th className="py-3 px-3 w-24 text-center">Ảnh 3×4</th>
                  <th className="py-3 px-4 w-28 font-mono-num">MSNV</th>
                  <th className="py-3 px-4">Họ và tên</th>
                  <th className="py-3 px-4">Bộ phận</th>
                  <th className="py-3 px-4 w-32 font-mono-num">Ngày vào làm</th>
                  <th className="py-3 px-4 w-40">Trạng thái in thẻ</th>
                  <th className="py-3 px-4 w-56 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredEmployees.map((emp) => {
                  const isSelected = selectedEmployeeIds.has(emp.id);
                  const isUploadingThis = uploadingPhotoEmpId === emp.id;
                  return (
                    <tr
                      key={emp.id}
                      className={
                        isSelected
                          ? 'bg-blue-50/50 hover:bg-blue-50'
                          : 'hover:bg-slate-50 transition-colors'
                      }
                    >
                      <td className="py-2.5 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => toggleSelectOne(emp.id)}
                          className="text-blue-600 cursor-pointer"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400" />
                          )}
                        </button>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <div className="relative inline-flex items-center justify-center group">
                          <label
                            className="w-10 h-13 rounded border border-slate-300 bg-white overflow-hidden flex flex-col items-center justify-center cursor-pointer hover:border-blue-600 transition-colors shadow-2xs relative"
                            title={`Bấm để tải hoặc đổi ảnh 3×4 cho ${emp.fullName}`}
                          >
                            {isUploadingThis ? (
                              <span className="text-[9px] font-bold text-blue-600 px-1">
                                Đang lưu...
                              </span>
                            ) : emp.photoUrl ? (
                              <>
                                <img
                                  src={emp.photoUrl}
                                  alt={emp.fullName}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                                <span className="absolute inset-0 bg-slate-900/55 text-white text-[9px] font-bold opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                  Đổi 3×4
                                </span>
                              </>
                            ) : (
                              <div className="flex flex-col items-center justify-center text-blue-700 hover:bg-blue-50 w-full h-full p-0.5">
                                <Camera className="w-3.5 h-3.5 mb-0.5 text-blue-600" />
                                <span className="text-[9px] font-bold leading-tight">
                                  + 3×4
                                </span>
                              </div>
                            )}
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) =>
                                handleDirectEmployeePhotoUpload(emp, e)
                              }
                              className="hidden"
                            />
                          </label>
                          {emp.photoUrl && !isUploadingThis && (
                            <button
                              type="button"
                              onClick={() => handleRemoveEmployeePhoto(emp)}
                              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow-xs"
                              title="Xóa ảnh 3×4 của nhân viên này"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 font-mono-num font-bold text-blue-700">
                        {emp.msnv}
                      </td>
                      <td className="py-2.5 px-4 font-bold text-slate-900">
                        {emp.fullName}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700">
                        {emp.department.replace(/^(?:bp\.?\s*){2,}/i, 'BP. ')}
                      </td>
                      <td className="py-2.5 px-4 font-mono-num text-slate-700">
                        {emp.joinDate}
                      </td>
                      <td className="py-2.5 px-4 font-mono-num">
                        {emp.printCount > 0 ? (
                          <span className="text-emerald-700 font-medium">
                            Đã in ({emp.printCount} lần) · {emp.lastPrintedAt}
                          </span>
                        ) : (
                          <span className="text-slate-400">Chưa in thẻ</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setFaceCropEmployee(emp);
                              setIsFaceCropModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg cursor-pointer transition-colors"
                            title={`Mở công cụ AI cắt ảnh 3×4 từ ảnh bất kỳ cho ${emp.fullName}`}
                          >
                            <ScanFace className="w-3.5 h-3.5" />
                            <span>Cắt 3×4 AI</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onOpenPrintDialog([emp.id]);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                            title="In thẻ nhân viên này (Ctrl + P)"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            In
                          </button>
                          <button
                            type="button"
                            onClick={() => setPreviewEmployee(emp)}
                            className="p-1.5 text-blue-700 hover:bg-blue-100 rounded-lg cursor-pointer"
                            title="Xem trước thẻ của nhân viên này"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(emp)}
                            className="p-1.5 text-slate-600 hover:bg-slate-200 rounded-lg cursor-pointer"
                            title="Sửa thông tin"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingEmployee(emp)}
                            className="p-1.5 text-red-600 hover:bg-red-100 rounded-lg cursor-pointer"
                            title="Xóa nhân viên"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal 1: Add / Edit Employee */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg overflow-hidden shadow-xl">
            <div className="px-6 py-4 bg-blue-700 text-white flex items-center justify-between">
              <h3 className="text-sm font-bold">
                {editingEmployee
                  ? `Cập Nhật Nhân Viên: ${editingEmployee.fullName}`
                  : 'Thêm Nhân Viên Mới'}
              </h3>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="p-1 rounded hover:bg-blue-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEmployeeForm} className="p-6 space-y-4 text-xs">
              {formError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Mã số nhân viên (MSNV) *
                  </label>
                  <input
                    type="text"
                    required
                    value={msnv}
                    onChange={(e) => setMsnv(e.target.value)}
                    placeholder="VD: 90993"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono-num focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Ngày vào làm (DD/MM/YYYY) *
                  </label>
                  <input
                    type="text"
                    required
                    value={joinDate}
                    onChange={(e) => setJoinDate(e.target.value)}
                    placeholder="VD: 02/10/2026"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono-num focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Họ và tên nhân viên *
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="VD: TRƯƠNG MINH HIẾU"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Bộ phận công tác *
                </label>
                <input
                  type="text"
                  required
                  list="department-suggestions"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="VD: Bảo trì vận hành"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                />
                <datalist id="department-suggestions">
                  <option value="Bảo trì vận hành" />
                  <option value="Sản xuất - Kỹ thuật" />
                  <option value="Kế toán - Tài chính" />
                  <option value="Hành chính - Nhân sự" />
                  <option value="Kho vận - Logistics" />
                  <option value="Kiểm soát chất lượng (QC)" />
                  <option value="Kinh doanh - Xuất nhập khẩu" />
                </datalist>
              </div>

              <div className="pt-2 border-t border-slate-200 flex items-center gap-4">
                <div className="w-16 h-20 rounded border border-slate-300 bg-white overflow-hidden shrink-0 flex items-center justify-center text-slate-400 font-bold">
                  {photoUrl ? (
                    <img
                      src={photoUrl}
                      alt="Preview"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span>3×4</span>
                  )}
                </div>
                <div className="space-y-1.5">
                  <div className="font-semibold text-slate-800">
                    Ảnh chân dung 3×4 (Không bắt buộc)
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      Chọn ảnh 3×4 từ máy tính
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoUpload}
                        className="hidden"
                      />
                    </label>
                    {photoUrl && (
                      <button
                        type="button"
                        onClick={() => setPhotoUrl('')}
                        className="text-red-600 hover:underline cursor-pointer"
                      >
                        Xóa ảnh
                      </button>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Ảnh sẽ tự động căn chuẩn tỷ lệ khung 3×4 trên thẻ nhân viên. Nếu chưa có ảnh, khung 3×4 sẽ để trống nền trắng để dán ảnh hoặc cập nhật sau.
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-4 py-2 font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 font-bold text-white bg-blue-700 hover:bg-blue-800 rounded-lg disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting
                    ? 'Đang lưu...'
                    : editingEmployee
                      ? 'Lưu Cập Nhật'
                      : 'Thêm Nhân Viên'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Quick Single-Employee Card Preview */}
      {previewEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl overflow-hidden shadow-xl">
            <div className="px-6 py-4 bg-blue-700 text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold">
                  Xem Trước Thẻ Nhân Viên: {previewEmployee.fullName} (MSNV: {previewEmployee.msnv})
                </h3>
                <p className="text-xs text-blue-100">
                  Mẫu thẻ đang áp dụng: {selectedTemplate.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewEmployee(null)}
                className="p-1 rounded hover:bg-blue-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-8 bg-slate-100 flex flex-col items-center justify-center overflow-x-auto">
              <div className="flex flex-col items-center">
                <span className="text-xs font-bold text-slate-600 uppercase mb-2.5">
                  Thẻ Nhân Viên Chuẩn In (Kích thước 145%)
                </span>
                <div
                  style={{
                    width: `${(selectedTemplate.orientation === 'portrait' ? 54 : 85.6) * 1.45}mm`,
                    height: `${(selectedTemplate.orientation === 'portrait' ? 85.6 : 54) * 1.45}mm`,
                  }}
                  className="shadow-md bg-white"
                >
                  <IdCardPreview
                    employee={previewEmployee}
                    template={selectedTemplate}
                    scale={1.45}
                  />
                </div>
              </div>
            </div>

            <div className="px-6 py-3.5 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const id = previewEmployee.id;
                    setPreviewEmployee(null);
                    onOpenPrintDialog([id]);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  In Thẻ Nhân Viên Này Ngay (Ctrl + P)
                </button>

                <label className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg cursor-pointer">
                  <Camera className="w-3.5 h-3.5" />
                  {previewEmployee.photoUrl ? 'Đổi Ảnh 3×4' : 'Chọn Ảnh 3×4'}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) =>
                      handleDirectEmployeePhotoUpload(previewEmployee, e)
                    }
                    className="hidden"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => setPreviewEmployee(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Delete Single Employee Confirmation */}
      {deletingEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <h3 className="text-sm font-bold text-slate-900">
              Xác nhận xóa nhân viên
            </h3>
            <p className="text-xs text-slate-600">
              Bạn có chắc chắn muốn xóa nhân viên{' '}
              <strong>{deletingEmployee.fullName}</strong> (MSNV:{' '}
              <strong>{deletingEmployee.msnv}</strong>) khỏi hệ thống?
            </p>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeletingEmployee(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={async () => {
                  const id = deletingEmployee.id;
                  setDeletingEmployee(null);
                  await onDeleteEmployee(id);
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer"
              >
                Xác Nhận Xóa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 4: Batch Delete Confirmation */}
      {confirmBatchDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <h3 className="text-sm font-bold text-slate-900">
              Xác nhận xóa {selectedEmployeeIds.size} nhân viên đã chọn
            </h3>
            <p className="text-xs text-slate-600">
              Bạn có chắc chắn muốn xóa {selectedEmployeeIds.size} nhân viên đang chọn khỏi cơ sở dữ liệu?
            </p>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmBatchDelete(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={async () => {
                  const ids = Array.from(selectedEmployeeIds);
                  setConfirmBatchDelete(false);
                  await onBatchDeleteEmployees(ids);
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer"
              >
                Xóa {selectedEmployeeIds.size} Nhân Viên
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 5: AI Face Detection & 3x4 Photo Cropper */}
      <FaceCropModal
        isOpen={isFaceCropModalOpen}
        onClose={() => setIsFaceCropModalOpen(false)}
        employees={employees}
        selectedTemplate={selectedTemplate}
        targetEmployee={faceCropEmployee}
        onUpdateEmployeePhoto={async (emp, newPhotoUrl) => {
          await onUpdateEmployee(emp.id, {
            msnv: emp.msnv,
            fullName: emp.fullName,
            department: emp.department,
            joinDate: emp.joinDate,
            photoUrl: newPhotoUrl,
          });
          setPhotoStatusBanner(
            `Đã cắt AI và lưu hình 3×4 cho nhân viên ${emp.fullName} (MSNV: ${emp.msnv})!`
          );
          setTimeout(() => setPhotoStatusBanner(null), 4000);
        }}
        onOpenPrintDialog={onOpenPrintDialog}
      />

      {/* Modal 6: Direct Drag & Drop Upload by MSNV (No Preview + Detailed Error Report) */}
      <DirectMsnvDropModal
        isOpen={isDirectMsnvModalOpen}
        onClose={() => setIsDirectMsnvModalOpen(false)}
        employees={employees}
        onUpdateEmployeePhoto={async (emp, newPhotoUrl) => {
          await onUpdateEmployee(emp.id, {
            msnv: emp.msnv,
            fullName: emp.fullName,
            department: emp.department,
            joinDate: emp.joinDate,
            photoUrl: newPhotoUrl,
          });
        }}
      />
    </div>
  );
};

