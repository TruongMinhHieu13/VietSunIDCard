import React, { useState, useMemo } from 'react';
import {
  FileSpreadsheet,
  Printer,
  Search,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { Employee, ImportHistory, PrintHistory } from '../types';

interface HistoryViewProps {
  employees: Employee[];
  importLogs: ImportHistory[];
  printLogs: PrintHistory[];
  onReprintEmployee: (employeeId: string) => void;
}

function formatTimestamp(ts: unknown): string {
  if (!ts) return 'Vừa xong';
  if (typeof ts === 'object' && ts !== null && 'seconds' in ts) {
    const secs = (ts as { seconds: number }).seconds;
    return new Date(secs * 1000).toLocaleString('vi-VN');
  }
  if (typeof ts === 'string') return ts;
  return new Date().toLocaleString('vi-VN');
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  employees,
  importLogs,
  printLogs,
  onReprintEmployee,
}) => {
  const [subTab, setSubTab] = useState<'printed_lookup' | 'print_logs' | 'import_logs'>(
    'printed_lookup'
  );
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupStatus, setLookupStatus] = useState<'ALL' | 'PRINTED' | 'UNPRINTED'>('ALL');

  const filteredLookupEmployees = useMemo(() => {
    return employees.filter((emp) => {
      const q = lookupQuery.trim().toLowerCase();
      const matchQ =
        !q ||
        emp.fullName.toLowerCase().includes(q) ||
        emp.msnv.toLowerCase().includes(q) ||
        emp.department.toLowerCase().includes(q);
      const matchStatus =
        lookupStatus === 'ALL' ||
        (lookupStatus === 'PRINTED' && emp.printCount > 0) ||
        (lookupStatus === 'UNPRINTED' && (!emp.printCount || emp.printCount === 0));
      return matchQ && matchStatus;
    });
  }, [employees, lookupQuery, lookupStatus]);

  return (
    <div className="space-y-5">
      {/* Header & Section Switcher */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Lịch Sử Import Excel, Lịch Sử In Thẻ &amp; Tra Cứu Nhân Viên Đã In
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Theo dõi toàn bộ nhật ký nhập file Excel, các lệnh in hàng loạt và tra cứu trạng thái cấp thẻ từng nhân sự
          </p>
        </div>

        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs">
          <button
            type="button"
            onClick={() => setSubTab('printed_lookup')}
            className={`px-3 py-2 font-semibold rounded-md cursor-pointer transition-colors ${
              subTab === 'printed_lookup'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Tra cứu NV đã in thẻ ({employees.filter((e) => e.printCount > 0).length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('print_logs')}
            className={`px-3 py-2 font-semibold rounded-md cursor-pointer transition-colors ${
              subTab === 'print_logs'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Lịch sử lệnh in ({printLogs.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('import_logs')}
            className={`px-3 py-2 font-semibold rounded-md cursor-pointer transition-colors ${
              subTab === 'import_logs'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Lịch sử Import Excel ({importLogs.length})
          </button>
        </div>
      </div>

      {/* TAB 1: Employee Print Status Lookup */}
      {subTab === 'printed_lookup' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={lookupQuery}
                onChange={(e) => setLookupQuery(e.target.value)}
                placeholder="Tra cứu tên, MSNV hoặc bộ phận..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setLookupStatus('PRINTED')}
                className={`px-3 py-1.5 font-semibold rounded cursor-pointer ${
                  lookupStatus === 'PRINTED'
                    ? 'bg-white text-emerald-700 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                Đã in thẻ ({employees.filter((e) => e.printCount > 0).length})
              </button>
              <button
                type="button"
                onClick={() => setLookupStatus('UNPRINTED')}
                className={`px-3 py-1.5 font-semibold rounded cursor-pointer ${
                  lookupStatus === 'UNPRINTED'
                    ? 'bg-white text-amber-700 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                Chưa in thẻ ({employees.filter((e) => !e.printCount).length})
              </button>
              <button
                type="button"
                onClick={() => setLookupStatus('ALL')}
                className={`px-3 py-1.5 font-semibold rounded cursor-pointer ${
                  lookupStatus === 'ALL'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                Tất cả ({employees.length})
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 w-28 font-mono-num">MSNV</th>
                  <th className="py-3 px-4">Họ và tên</th>
                  <th className="py-3 px-4">Bộ phận</th>
                  <th className="py-3 px-4 w-32 font-mono-num">Ngày vào làm</th>
                  <th className="py-3 px-4 w-36 font-mono-num">Số lần đã in</th>
                  <th className="py-3 px-4 w-44 font-mono-num">Lần in gần nhất</th>
                  <th className="py-3 px-4 w-36 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredLookupEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-500">
                      Không tìm thấy nhân viên nào khớp với điều kiện tra cứu.
                    </td>
                  </tr>
                ) : (
                  filteredLookupEmployees.map((emp) => (
                    <tr key={emp.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-mono-num font-bold text-blue-700">
                        {emp.msnv}
                      </td>
                      <td className="py-2.5 px-4 font-bold text-slate-900">
                        {emp.fullName}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700">
                        {emp.department.replace(/^(?:bp\.?\s*){2,}/i, 'BP. ')}
                      </td>
                      <td className="py-2.5 px-4 font-mono-num text-slate-600">
                        {emp.joinDate}
                      </td>
                      <td className="py-2.5 px-4 font-mono-num">
                        {emp.printCount > 0 ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {emp.printCount} lần
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-600">
                            <Clock className="w-3.5 h-3.5" />
                            Chưa in
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-mono-num text-slate-600">
                        {emp.lastPrintedAt || '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => onReprintEmployee(emp.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg cursor-pointer"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          {emp.printCount > 0 ? 'In lại thẻ' : 'In thẻ ngay'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Print Job Logs */}
      {subTab === 'print_logs' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {printLogs.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-500">
              Chưa có lịch sử in thẻ nào được ghi nhận.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 w-44 font-mono-num">Thời gian</th>
                    <th className="py-3 px-4 w-40">Phương thức</th>
                    <th className="py-3 px-4">Mẫu thẻ sử dụng</th>
                    <th className="py-3 px-4 w-28 font-mono-num">Số lượng thẻ</th>
                    <th className="py-3 px-4 w-28 font-mono-num">Số trang</th>
                    <th className="py-3 px-4">Danh sách nhân viên đã in</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {printLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono-num text-slate-600">
                        {formatTimestamp(log.createdAt)}
                      </td>
                      <td className="py-3 px-4 font-semibold text-blue-700">
                        {log.printMode === 'pdf_export'
                          ? 'Xuất PDF chuẩn mm'
                          : log.printMode === 'cr80_direct'
                            ? 'Máy in thẻ nhựa CR80'
                            : `In dàn trang (${log.paperSize})`}
                        {log.duplex ? ' · 2 Mặt' : ' · 1 Mặt'}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900">
                        {log.templateName}
                      </td>
                      <td className="py-3 px-4 font-mono-num font-bold text-emerald-700">
                        {log.totalCards} thẻ
                      </td>
                      <td className="py-3 px-4 font-mono-num text-slate-700">
                        {log.totalPages} trang
                      </td>
                      <td className="py-3 px-4 text-slate-600 max-w-md truncate" title={log.employeeSummary}>
                        {log.employeeSummary}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Excel Import Logs */}
      {subTab === 'import_logs' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {importLogs.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-500">
              <FileSpreadsheet className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              Chưa có lịch sử Import Excel nào.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 w-44 font-mono-num">Thời gian</th>
                    <th className="py-3 px-4">Tên file Excel</th>
                    <th className="py-3 px-4 w-44">Chế độ xử lý</th>
                    <th className="py-3 px-4 w-28 font-mono-num">Tổng dòng</th>
                    <th className="py-3 px-4 w-32 font-mono-num">Thêm mới</th>
                    <th className="py-3 px-4 w-32 font-mono-num">Cập nhật</th>
                    <th className="py-3 px-4 w-28 font-mono-num">Dòng lỗi</th>
                    <th className="py-3 px-4">Ghi chú</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {importLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono-num text-slate-600">
                        {formatTimestamp(log.createdAt)}
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-900">
                        {log.fileName}
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        {log.importMode === 'upsert'
                          ? 'Thêm mới & Cập nhật trùng'
                          : 'Chỉ thêm nhân viên mới'}
                      </td>
                      <td className="py-3 px-4 font-mono-num font-semibold">
                        {log.totalRows}
                      </td>
                      <td className="py-3 px-4 font-mono-num font-bold text-emerald-700">
                        +{log.importedCount}
                      </td>
                      <td className="py-3 px-4 font-mono-num font-bold text-blue-700">
                        {log.updatedCount}
                      </td>
                      <td className="py-3 px-4 font-mono-num font-bold text-red-600">
                        {log.errorCount}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {log.summaryNote}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
