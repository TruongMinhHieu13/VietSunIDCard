import React from 'react';
import { Palette, Printer } from 'lucide-react';
import {
  ActiveTab,
  CardTemplate,
  Employee,
  ImportHistory,
  PrintHistory,
} from '../types';
import { IdCardPreview } from './IdCardPreview';

interface DashboardViewProps {
  employees: Employee[];
  templates: CardTemplate[];
  selectedTemplate: CardTemplate;
  importLogs: ImportHistory[];
  printLogs: PrintHistory[];
  onNavigate: (tab: ActiveTab) => void;
  onOpenImportModal: () => void;
  onPrintDepartment: (department: string) => void;
  onSeedSampleEmployees: () => Promise<void>;
  onOpenPrintDialog: (employeeIds?: string[]) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  selectedTemplate,
  onNavigate,
  onOpenPrintDialog,
}) => {
  const sampleCardEmployee: Employee = {
    id: 'sample-demo',
    msnv: '06868',
    fullName: 'TÊN NHÂN VIÊN',
    department: 'Bảo trì vận hành',
    joinDate: '02/10/2026',
    photoUrl: '',
    printCount: 0,
    lastPrintedAt: '',
    ownerId: '',
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Mẫu Thẻ Đang Áp Dụng (CR80: 85.6mm × 54mm)
            </h2>
            <p className="text-xs text-slate-500">{selectedTemplate.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenPrintDialog()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              In thẻ ngay
            </button>
            <button
              type="button"
              onClick={() => onNavigate('designer')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg cursor-pointer transition-colors"
            >
              <Palette className="w-3.5 h-3.5" />
              Tùy chỉnh mẫu
            </button>
          </div>
        </div>

        <div className="bg-slate-100 border border-slate-200 rounded-xl p-6 flex flex-col items-center justify-center overflow-x-auto">
          <div
            style={{
              width: `${(selectedTemplate.orientation === 'portrait' ? 54 : 85.6) * 1.35}mm`,
              height: `${(selectedTemplate.orientation === 'portrait' ? 85.6 : 54) * 1.35}mm`,
            }}
            className="shadow-md bg-white"
          >
            <IdCardPreview
              employee={sampleCardEmployee}
              template={selectedTemplate}
              scale={1.35}
            />
          </div>
          <span className="text-[11px] text-slate-500 mt-3 font-mono-num">
            Bản dựng tự động từ dữ liệu nhân viên: {sampleCardEmployee.fullName} ({sampleCardEmployee.msnv})
          </span>
        </div>
      </div>
    </div>
  );
};
