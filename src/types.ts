export interface Employee {
  id: string;
  msnv: string;
  fullName: string;
  department: string;
  joinDate: string;
  photoUrl: string;
  printCount: number;
  lastPrintedAt: string;
  ownerId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type CardLayoutStyle =
  | 'vietsun_table'
  | 'modern_corporate'
  | 'minimal_vertical'
  | 'custom_freeform';

export interface CardTemplate {
  id: string;
  name: string;
  layoutStyle: CardLayoutStyle;
  orientation: 'landscape' | 'portrait';
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  borderColor: string;
  fontFamily: string;
  companyBranch: string;
  companyNameLine1: string;
  companyNameLine2: string;
  companyTagline: string;
  logoText: string;
  logoUrl: string;
  showStamp: boolean;
  stampOpacity: number;
  stampOffsetX: number;
  stampOffsetY: number;
  nameFontSize: number;
  msnvFontSize: number;
  deptFontSize: number;
  dateFontSize: number;
  headerFontSize: number;
  deptPrefix: string;
  photoBgColor: string;
  photoWidthPercent: number;
  nameOffsetY: number;
  msnvOffsetY: number;
  deptOffsetY: number;
  dateOffsetY: number;
  backTitle: string;
  backRules: string;
  backAddress: string;
  backPhone: string;
  showQrOnBack: boolean;
  isDefault: boolean;
  ownerId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ImportHistory {
  id: string;
  fileName: string;
  importMode: 'add_only' | 'upsert';
  totalRows: number;
  validCount: number;
  errorCount: number;
  importedCount: number;
  updatedCount: number;
  summaryNote: string;
  ownerId: string;
  createdAt?: unknown;
}

export interface PrintHistory {
  id: string;
  printMode: 'a4_grid' | 'cr80_direct' | 'pdf_export';
  templateName: string;
  totalCards: number;
  totalPages: number;
  paperSize: string;
  duplex: boolean;
  employeeSummary: string;
  ownerId: string;
  createdAt?: unknown;
}

export interface AppSettings {
  id: string;
  companyName: string;
  companyBranch: string;
  companySubName: string;
  logoUrl: string;
  defaultPaperSize: 'A4' | 'CR80' | 'Letter';
  defaultCols: number;
  defaultRows: number;
  defaultGapMm: number;
  defaultMarginMm: number;
  cardWidthMm: number;
  cardHeightMm: number;
  ownerId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type ActiveTab =
  | 'dashboard'
  | 'employees'
  | 'designer'
  | 'print'
  | 'history'
  | 'settings';

export const OFFICIAL_VIETSUN_LOGO = '/assets/aistudio/VIETSUN_b5e42dd9.png';
export const OFFICIAL_VIETSUN_FAVICON = '/assets/aistudio/favicon-300x300-9373_51eea8e9.png';

export const DEFAULT_CARD_TEMPLATES: Omit<CardTemplate, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'Mẫu chuẩn VIETSUN ĐỒNG NAI (Khung bảng)',
    layoutStyle: 'vietsun_table',
    orientation: 'landscape',
    primaryColor: '#57534e',
    secondaryColor: '#f59e0b',
    backgroundColor: '#ffffff',
    textColor: '#1c1917',
    borderColor: '#292524',
    fontFamily: "'Noto Serif', 'Times New Roman', serif",
    companyBranch: 'VIETSUN ĐỒNG NAI',
    companyNameLine1: 'CHI NHÁNH CÔNG TY CỔ PHẦN',
    companyNameLine2: 'ĐẦU TƯ MẶT TRỜI VIỆT',
    companyTagline: 'Warming Your Life',
    logoText: 'VIETSUN',
    logoUrl: OFFICIAL_VIETSUN_LOGO,
    showStamp: false,
    stampOpacity: 0,
    stampOffsetX: 0,
    stampOffsetY: 0,
    nameFontSize: 13.5,
    msnvFontSize: 14,
    deptFontSize: 12.5,
    dateFontSize: 12,
    headerFontSize: 8.5,
    deptPrefix: 'BP. ',
    photoBgColor: '#ffffff',
    photoWidthPercent: 22.5,
    nameOffsetY: 0,
    msnvOffsetY: 0,
    deptOffsetY: 0,
    dateOffsetY: 0,
    backTitle: '',
    backRules: '',
    backAddress: '',
    backPhone: '',
    showQrOnBack: false,
    isDefault: true,
  },
  {
    name: 'Mẫu Doanh Nghiệp Hiện Đại (Xanh Dương)',
    layoutStyle: 'modern_corporate',
    orientation: 'landscape',
    primaryColor: '#1d4ed8',
    secondaryColor: '#3b82f6',
    backgroundColor: '#ffffff',
    textColor: '#0f172a',
    borderColor: '#cbd5e1',
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    companyBranch: 'VIETSUN ĐỒNG NAI',
    companyNameLine1: 'CHI NHÁNH CÔNG TY CỔ PHẦN',
    companyNameLine2: 'ĐẦU TƯ MẶT TRỜI VIỆT',
    companyTagline: 'Warming Your Life',
    logoText: 'VIETSUN',
    logoUrl: OFFICIAL_VIETSUN_LOGO,
    showStamp: false,
    stampOpacity: 0.7,
    stampOffsetX: 0,
    stampOffsetY: 0,
    nameFontSize: 13,
    msnvFontSize: 12,
    deptFontSize: 11,
    dateFontSize: 10,
    headerFontSize: 8,
    deptPrefix: 'Bộ phận: ',
    photoBgColor: '#ffffff',
    photoWidthPercent: 30,
    nameOffsetY: 0,
    msnvOffsetY: 0,
    deptOffsetY: 0,
    dateOffsetY: 0,
    backTitle: 'QUY ĐỊNH SỬ DỤNG THẺ NHÂN VIÊN',
    backRules:
      '1. Nhân viên đeo thẻ trong suốt giờ làm việc.\n2. Bảo quản thẻ cẩn thận, không bẻ cong hoặc làm trầy xước.\n3. Nhặt được thẻ vui lòng liên hệ Phòng Nhân sự.',
    backAddress: 'Chi nhánh Đồng Nai - Công ty Cổ phần Đầu tư Mặt Trời Việt',
    backPhone: 'ĐT: (0251) 388 9999',
    showQrOnBack: true,
    isDefault: false,
  },
  {
    name: 'Mẫu Thẻ Đứng Hiện Đại (Portrait CR80)',
    layoutStyle: 'minimal_vertical',
    orientation: 'portrait',
    primaryColor: '#1e40af',
    secondaryColor: '#f59e0b',
    backgroundColor: '#ffffff',
    textColor: '#0f172a',
    borderColor: '#94a3b8',
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    companyBranch: 'VIETSUN ĐỒNG NAI',
    companyNameLine1: 'CÔNG TY CP ĐẦU TƯ MẶT TRỜI VIỆT',
    companyNameLine2: 'THẺ NHÂN VIÊN',
    companyTagline: 'Warming Your Life',
    logoText: 'VIETSUN',
    logoUrl: OFFICIAL_VIETSUN_LOGO,
    showStamp: false,
    stampOpacity: 0.75,
    stampOffsetX: 0,
    stampOffsetY: 0,
    nameFontSize: 13,
    msnvFontSize: 12,
    deptFontSize: 11,
    dateFontSize: 10,
    headerFontSize: 8,
    deptPrefix: 'BP. ',
    photoBgColor: '#ffffff',
    photoWidthPercent: 35,
    nameOffsetY: 0,
    msnvOffsetY: 0,
    deptOffsetY: 0,
    dateOffsetY: 0,
    backTitle: 'THÔNG TIN & QUY ĐỊNH',
    backRules:
      '1. Đeo thẻ khi ra vào cổng và trong suốt ca làm việc.\n2. Không tự ý tẩy xóa, dán đè lên bề mặt thẻ.\n3. Liên hệ Phòng Nhân sự nếu thất lạc thẻ.',
    backAddress: 'Chi nhánh Đồng Nai - Công ty Cổ phần Đầu tư Mặt Trời Việt',
    backPhone: 'ĐT: (0251) 388 9999',
    showQrOnBack: true,
    isDefault: false,
  },
];

export const SAMPLE_EMPLOYEES_SEED = [
  {
    msnv: '90993',
    fullName: 'TRƯƠNG MINH HIẾU',
    department: 'Bảo trì vận hành',
    joinDate: '02/10/2026',
    photoUrl: '',
    printCount: 1,
    lastPrintedAt: '11/11/2026',
  },
  {
    msnv: '90994',
    fullName: 'NGUYỄN VĂN HOÀNG',
    department: 'Bảo trì vận hành',
    joinDate: '05/10/2026',
    photoUrl: '',
    printCount: 0,
    lastPrintedAt: '',
  },
  {
    msnv: '90995',
    fullName: 'TRẦN THỊ MINH TÂM',
    department: 'Kế toán - Tài chính',
    joinDate: '12/09/2026',
    photoUrl: '',
    printCount: 1,
    lastPrintedAt: '10/11/2026',
  },
  {
    msnv: '90996',
    fullName: 'LÊ QUỐC KHÁNH',
    department: 'Sản xuất - Kỹ thuật',
    joinDate: '15/08/2026',
    photoUrl: '',
    printCount: 0,
    lastPrintedAt: '',
  },
  {
    msnv: '90997',
    fullName: 'PHẠM THỊ THU HÀ',
    department: 'Hành chính - Nhân sự',
    joinDate: '01/06/2026',
    photoUrl: '',
    printCount: 2,
    lastPrintedAt: '09/11/2026',
  },
  {
    msnv: '90998',
    fullName: 'ĐỖ ĐỨC THẮNG',
    department: 'Kho vận - Logistics',
    joinDate: '20/10/2026',
    photoUrl: '',
    printCount: 0,
    lastPrintedAt: '',
  },
  {
    msnv: '90999',
    fullName: 'VŨ HOÀNG NAM',
    department: 'Kiểm soát chất lượng (QC)',
    joinDate: '25/10/2026',
    photoUrl: '',
    printCount: 0,
    lastPrintedAt: '',
  },
  {
    msnv: '91000',
    fullName: 'HOÀNG THỊ NGỌC ANH',
    department: 'Kinh doanh - Xuất nhập khẩu',
    joinDate: '01/11/2026',
    photoUrl: '',
    printCount: 0,
    lastPrintedAt: '',
  },
];
