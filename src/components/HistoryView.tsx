import React, { useState, useMemo } from 'react';
import {
  FileSpreadsheet,
  Printer,
  Search,
  CheckCircle2,
  Clock,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { Employee, ImportHistory, PrintHistory } from '../types';

interface HistoryViewProps {
  employees: Employee[];
  importLogs: ImportHistory[];
  printLogs: PrintHistory[];
  onReprintEmployee: (employeeId: string) => void;
}

function getTimestampMs(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number' && !Number.isNaN(ts)) return ts;
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (typeof ts === 'object' && ts !== null) {
    const obj = ts as {
      toMillis?: () => number;
      seconds?: number;
      nanoseconds?: number;
    };
    if (typeof obj.toMillis === 'function') return obj.toMillis();
    if (typeof obj.seconds === 'number') {
      return obj.seconds * 1000 + Math.floor((obj.nanoseconds || 0) / 1e6);
    }
  }
  return 0;
}

function formatTimestamp(ts: unknown): string {
  if (!ts) return 'Vừa xong';
  if (typeof ts === 'object' && ts !== null && 'seconds' in ts) {
    const secs = (ts as { seconds: number }).seconds;
    return new Date(secs * 1000).toLocaleString('vi-VN');
  }
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toLocaleString('vi-VN');
    }
    return ts;
  }
  return new Date().toLocaleString('vi-VN');
}

function buildVisiblePages(
  totalPages: number,
  safeCurrentPage: number
): (number | 'ellipsis-start' | 'ellipsis-end')[] {
  const pages: (number | 'ellipsis-start' | 'ellipsis-end')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
    return pages;
  }
  pages.push(1);
  if (safeCurrentPage > 3) {
    pages.push('ellipsis-start');
  }
  const start = Math.max(2, safeCurrentPage - 1);
  const end = Math.min(totalPages - 1, safeCurrentPage + 1);
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }
  if (safeCurrentPage < totalPages - 2) {
    pages.push('ellipsis-end');
  }
  pages.push(totalPages);
  return pages;
}

interface PaginationFooterProps {
  totalItems: number;
  currentPage: number;
  pageSize: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

const PaginationFooter: React.FC<PaginationFooterProps> = ({
  totalItems,
  currentPage,
  pageSize,
  itemLabel,
  onPageChange,
  onPageSizeChange,
}) => {
  if (totalItems === 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const visiblePageNumbers = buildVisiblePages(totalPages, safeCurrentPage);

  return (
    <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div className="flex flex-wrap items-center gap-3 text-slate-600">
        <span>
          Hiển thị{' '}
          <strong className="font-mono-num text-slate-900">
            {(safeCurrentPage - 1) * pageSize + 1}
          </strong>
          –
          <strong className="font-mono-num text-slate-900">
            {Math.min(safeCurrentPage * pageSize, totalItems)}
          </strong>{' '}
          trong tổng số{' '}
          <strong className="font-mono-num text-blue-700">{totalItems}</strong>{' '}
          {itemLabel}
        </span>

        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">Số dòng:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              onPageSizeChange(Number(e.target.value));
              onPageChange(1);
            }}
            className="px-2 py-1 bg-white border border-slate-300 rounded-lg text-xs font-mono-num font-semibold text-slate-700 focus:outline-none focus:border-blue-600 cursor-pointer"
          >
            <option value={10}>10 / trang</option>
            <option value={20}>20 / trang</option>
            <option value={50}>50 / trang</option>
            <option value={100}>100 / trang</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={safeCurrentPage <= 1}
          onClick={() => onPageChange(1)}
          className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          title="Trang đầu"
        >
          <ChevronsLeft className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          disabled={safeCurrentPage <= 1}
          onClick={() => onPageChange(Math.max(1, safeCurrentPage - 1))}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 font-medium hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span>Trước</span>
        </button>

        {visiblePageNumbers.map((item) =>
          typeof item === 'number' ? (
            <button
              key={item}
              type="button"
              onClick={() => onPageChange(item)}
              className={`min-w-[30px] h-7 px-2 rounded-lg font-mono-num font-bold text-xs transition-colors cursor-pointer ${
                item === safeCurrentPage
                  ? 'bg-blue-700 text-white shadow-2xs'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {item}
            </button>
          ) : (
            <span
              key={item}
              className="px-1.5 text-slate-400 font-mono-num select-none"
            >
              ...
            </span>
          )
        )}

        <button
          type="button"
          disabled={safeCurrentPage >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, safeCurrentPage + 1))}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 font-medium hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
        >
          <span>Sau</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          disabled={safeCurrentPage >= totalPages}
          onClick={() => onPageChange(totalPages)}
          className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          title="Trang cuối"
        >
          <ChevronsRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

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

  // Pagination state per sub-tab
  const [lookupPage, setLookupPage] = useState(1);
  const [printLogsPage, setPrintLogsPage] = useState(1);
  const [importLogsPage, setImportLogsPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);

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

  const sortedPrintLogs = useMemo(() => {
    return [...printLogs].sort(
      (a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt)
    );
  }, [printLogs]);

  const sortedImportLogs = useMemo(() => {
    return [...importLogs].sort(
      (a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt)
    );
  }, [importLogs]);

  // Paginated slices
  const lookupTotalPages = Math.max(
    1,
    Math.ceil(filteredLookupEmployees.length / pageSize)
  );
  const safeLookupPage = Math.min(Math.max(1, lookupPage), lookupTotalPages);
  const paginatedLookupEmployees = useMemo(() => {
    const start = (safeLookupPage - 1) * pageSize;
    return filteredLookupEmployees.slice(start, start + pageSize);
  }, [filteredLookupEmployees, safeLookupPage, pageSize]);

  const printLogsTotalPages = Math.max(
    1,
    Math.ceil(sortedPrintLogs.length / pageSize)
  );
  const safePrintLogsPage = Math.min(
    Math.max(1, printLogsPage),
    printLogsTotalPages
  );
  const paginatedPrintLogs = useMemo(() => {
    const start = (safePrintLogsPage - 1) * pageSize;
    return sortedPrintLogs.slice(start, start + pageSize);
  }, [sortedPrintLogs, safePrintLogsPage, pageSize]);

  const importLogsTotalPages = Math.max(
    1,
    Math.ceil(sortedImportLogs.length / pageSize)
  );
  const safeImportLogsPage = Math.min(
    Math.max(1, importLogsPage),
    importLogsTotalPages
  );
  const paginatedImportLogs = useMemo(() => {
    const start = (safeImportLogsPage - 1) * pageSize;
    return sortedImportLogs.slice(start, start + pageSize);
  }, [sortedImportLogs, safeImportLogsPage, pageSize]);

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
                onChange={(e) => {
                  setLookupQuery(e.target.value);
                  setLookupPage(1);
                }}
                placeholder="Tra cứu tên, MSNV hoặc bộ phận..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => {
                  setLookupStatus('PRINTED');
                  setLookupPage(1);
                }}
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
                onClick={() => {
                  setLookupStatus('UNPRINTED');
                  setLookupPage(1);
                }}
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
                onClick={() => {
                  setLookupStatus('ALL');
                  setLookupPage(1);
                }}
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
                {paginatedLookupEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-500">
                      Không tìm thấy nhân viên nào khớp với điều kiện tra cứu.
                    </td>
                  </tr>
                ) : (
                  paginatedLookupEmployees.map((emp) => (
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

            <PaginationFooter
              totalItems={filteredLookupEmployees.length}
              currentPage={safeLookupPage}
              pageSize={pageSize}
              itemLabel="nhân viên"
              onPageChange={setLookupPage}
              onPageSizeChange={setPageSize}
            />
          </div>
        </div>
      )}

      {/* TAB 2: Print Job Logs */}
      {subTab === 'print_logs' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {sortedPrintLogs.length === 0 ? (
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
                  {paginatedPrintLogs.map((log) => (
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

              <PaginationFooter
                totalItems={sortedPrintLogs.length}
                currentPage={safePrintLogsPage}
                pageSize={pageSize}
                itemLabel="lệnh in"
                onPageChange={setPrintLogsPage}
                onPageSizeChange={setPageSize}
              />
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Excel Import Logs */}
      {subTab === 'import_logs' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {sortedImportLogs.length === 0 ? (
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
                  {paginatedImportLogs.map((log) => (
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

              <PaginationFooter
                totalItems={sortedImportLogs.length}
                currentPage={safeImportLogsPage}
                pageSize={pageSize}
                itemLabel="lần import"
                onPageChange={setImportLogsPage}
                onPageSizeChange={setPageSize}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

