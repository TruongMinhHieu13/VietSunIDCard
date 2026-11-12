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
} from 'lucide-react';
import { CardTemplate, Employee } from '../types';
import { IdCardPreview } from './IdCardPreview';
import {
  downloadSampleExcelTemplate,
  exportEmployeesToExcel,
} from './ExcelImportModal';

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
  }) => Promise<void>;
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

  // Quick Card Preview Modal
  const [previewEmployee, setPreviewEmployee] = useState<Employee | null>(null);

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
      return matchQuery && matchDept && matchPrinted;
    });
  }, [employees, searchQuery, deptFilter, printStatusFilter]);

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

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Compress to standard 3x4 portrait resolution (300x400) so Firestore doc stays lightweight
        const canvas = document.createElement('canvas');
        const targetW = 300;
        const targetH = 400;
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#1d4ed8';
          ctx.fillRect(0, 0, targetW, targetH);
          const scale = Math.max(targetW / img.width, targetH / img.height);
          const drawW = img.width * scale;
          const drawH = img.height * scale;
          const dx = (targetW - drawW) / 2;
          const dy = (targetH - drawH) / 2;
          ctx.drawImage(img, dx, dy, drawW, drawH);
          const compressed = canvas.toDataURL('image/jpeg', 0.82);
          setPhotoUrl(compressed);
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
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
            Quản lý hồ sơ nhân viên, kiểm tra trùng MSNV, nhập/xuất file Excel và chọn in thẻ hàng loạt
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

      {/* Filter & Batch Action Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative w-full sm:w-72">
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
        </div>

        {/* Batch Selection Action Buttons */}
        <div className="flex items-center gap-2">
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
                  <th className="py-3 px-3 w-14 text-center">Ảnh</th>
                  <th className="py-3 px-4 w-28 font-mono-num">MSNV</th>
                  <th className="py-3 px-4">Họ và tên</th>
                  <th className="py-3 px-4">Bộ phận</th>
                  <th className="py-3 px-4 w-32 font-mono-num">Ngày vào làm</th>
                  <th className="py-3 px-4 w-40">Trạng thái in thẻ</th>
                  <th className="py-3 px-4 w-36 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredEmployees.map((emp) => {
                  const isSelected = selectedEmployeeIds.has(emp.id);
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
                        {emp.photoUrl ? (
                          <img
                            src={emp.photoUrl}
                            alt={emp.fullName}
                            referrerPolicy="no-referrer"
                            className="w-8 h-10 object-cover rounded border border-slate-300 mx-auto"
                          />
                        ) : (
                          <div className="w-8 h-10 rounded bg-blue-700 text-white font-bold text-[10px] flex items-center justify-center mx-auto">
                            {emp.fullName
                              .trim()
                              .split(/\s+/)
                              .slice(-2)
                              .map((w) => w[0])
                              .join('')
                              .toUpperCase()}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-mono-num font-bold text-blue-700">
                        {emp.msnv}
                      </td>
                      <td className="py-2.5 px-4 font-bold text-slate-900">
                        {emp.fullName}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700">
                        BP. {emp.department}
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
                      Chọn ảnh từ máy tính
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
                    Nếu chưa có ảnh, thẻ sẽ hiển thị ảnh đại diện mặc định nền xanh chuẩn 3×4.
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

            <div className="px-6 py-3.5 bg-white border-t border-slate-200 flex items-center justify-between">
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
    </div>
  );
};
