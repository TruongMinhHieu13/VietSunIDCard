import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';

const FIREBASE_CONFIG = {
  projectId: 'probable-physics-wtvkm',
  appId: '1:386099113045:web:5333e1ff36ce377877b8dc',
  apiKey: 'AIzaSyDCv_PrCs9AD8J0pnQ0Uznl4CID_xtr95k',
  authDomain: 'probable-physics-wtvkm.firebaseapp.com',
  firestoreDatabaseId: 'ai-studio-723bc085-ecf8-47b9-ba1b-9177b1900bea',
  storageBucket: 'probable-physics-wtvkm.firebasestorage.app',
  messagingSenderId: '386099113045',
};

const WORKSPACE_ID = 'vietsun_workspace';

const firebaseApp =
  getApps().length === 0 ? initializeApp(FIREBASE_CONFIG) : getApp();
const db = getFirestore(firebaseApp, FIREBASE_CONFIG.firestoreDatabaseId);

interface RawEmployeeDoc {
  msnv?: string;
  fullName?: string;
  department?: string;
  joinDate?: string;
  photoUrl?: string;
  printCount?: number;
  lastPrintedAt?: string;
  ownerId?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface VercelReq {
  method?: string;
  url?: string;
  query?: Record<string, string | string[] | undefined>;
}

interface VercelRes {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => VercelRes;
  json: (body: unknown) => void;
  end: () => void;
}

function getQueryString(
  req: VercelReq,
  key: string,
  defaultValue = ''
): string {
  const val = req.query?.[key];
  if (Array.isArray(val)) return String(val[0] ?? defaultValue).trim();
  if (typeof val === 'string') return val.trim();
  return defaultValue;
}

function getCreatedAtMs(rawCreatedAt: unknown, docId?: string): number {
  if (typeof rawCreatedAt === 'number' && !Number.isNaN(rawCreatedAt)) {
    return rawCreatedAt;
  }
  if (typeof rawCreatedAt === 'string') {
    const parsed = Date.parse(rawCreatedAt);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (rawCreatedAt && typeof rawCreatedAt === 'object') {
    const obj = rawCreatedAt as {
      toMillis?: () => number;
      seconds?: number;
      nanoseconds?: number;
    };
    if (typeof obj.toMillis === 'function') return obj.toMillis();
    if (typeof obj.seconds === 'number') {
      return obj.seconds * 1000 + Math.floor((obj.nanoseconds || 0) / 1e6);
    }
  }
  const idMatch = docId?.match(/^emp_(\d{10,15})_/);
  if (idMatch) {
    return parseInt(idMatch[1], 10);
  }
  return 0;
}

function normalizeIsoTimestamp(rawTs: unknown, docId?: string): string | null {
  const ms = getCreatedAtMs(rawTs, docId);
  return ms > 0 ? new Date(ms).toISOString() : null;
}

function stripViAccents(str: string): string {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

async function fetchAllWorkspaceEmployees() {
  const snap = await getDocs(
    query(collection(db, 'employees'), where('ownerId', '==', WORKSPACE_ID))
  );

  const list = snap.docs.map((d) => {
    const raw = d.data() as RawEmployeeDoc;
    const isOverwritten90993 =
      raw.msnv?.trim() === '06868' ||
      raw.fullName?.trim().toUpperCase() === 'TÊN NHÂN VIÊN';

    const msnv = isOverwritten90993 ? '90993' : raw.msnv || '';
    const fullName = isOverwritten90993
      ? 'TRƯƠNG MINH HIẾU'
      : raw.fullName || '';
    const department =
      isOverwritten90993 &&
      (!raw.department || raw.department === 'Bảo trì vận hành')
        ? 'BP. Bảo trì vận hành'
        : raw.department || '';

    const createdAtMs = getCreatedAtMs(raw.createdAt, d.id);
    const updatedAtMs = getCreatedAtMs(raw.updatedAt, d.id);

    return {
      id: d.id,
      msnv,
      fullName,
      department,
      joinDate: raw.joinDate || '',
      photoUrl: raw.photoUrl || '',
      hasPhoto: Boolean(raw.photoUrl && raw.photoUrl.trim().length > 0),
      printCount: typeof raw.printCount === 'number' ? raw.printCount : 0,
      lastPrintedAt: raw.lastPrintedAt || '',
      createdAt: normalizeIsoTimestamp(raw.createdAt, d.id),
      updatedAt: normalizeIsoTimestamp(raw.updatedAt, d.id),
      _sortMs: createdAtMs || updatedAtMs || 0,
    };
  });

  list.sort((a, b) => {
    const diff = b._sortMs - a._sortMs;
    if (diff !== 0) return diff;
    return a.msnv.localeCompare(b.msnv, undefined, { numeric: true });
  });

  return list;
}

export default async function handler(req: VercelReq, res: VercelRes) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-API-Key, Accept'
  );

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const allEmployees = await fetchAllWorkspaceEmployees();
    const includePhoto =
      getQueryString(req, 'includePhoto', 'true').toLowerCase() !== 'false';

    // Handle single employee lookup via /api/employees/:msnvOrId rewrite
    const singleKey = getQueryString(req, 'singleMsnvOrId').toLowerCase();
    if (singleKey) {
      const found = allEmployees.find(
        (emp) =>
          emp.msnv.trim().toLowerCase() === singleKey ||
          emp.id.trim().toLowerCase() === singleKey
      );
      if (!found) {
        res.status(404).json({
          success: false,
          error: `Không tìm thấy nhân viên với mã hoặc ID "${singleKey}".`,
        });
        return;
      }
      const { _sortMs, ...employeeData } = found;
      res.status(200).json({
        success: true,
        data: includePhoto
          ? employeeData
          : { ...employeeData, photoUrl: '' },
      });
      return;
    }

    const searchParam =
      getQueryString(req, 'search') || getQueryString(req, 'q');
    const departmentParam = getQueryString(req, 'department');
    const msnvParam = getQueryString(req, 'msnv');
    const printedParam = getQueryString(req, 'printed').toLowerCase();
    const hasPhotoParam = getQueryString(req, 'hasPhoto').toLowerCase();

    const msnvSet = msnvParam
      ? new Set(
          msnvParam
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
        )
      : null;

    const searchNorm = stripViAccents(searchParam);
    const deptNorm = stripViAccents(departmentParam);

    const filtered = allEmployees.filter((emp) => {
      if (msnvSet && !msnvSet.has(emp.msnv.trim().toLowerCase())) {
        return false;
      }
      if (searchNorm) {
        const matchName = stripViAccents(emp.fullName).includes(searchNorm);
        const matchMsnv = emp.msnv.toLowerCase().includes(searchNorm);
        if (!matchName && !matchMsnv) return false;
      }
      if (deptNorm && deptNorm !== 'all') {
        const empDeptNorm = stripViAccents(emp.department);
        if (empDeptNorm !== deptNorm && !empDeptNorm.includes(deptNorm)) {
          return false;
        }
      }
      if (printedParam === 'true' || printedParam === '1') {
        if (!emp.printCount || emp.printCount <= 0) return false;
      } else if (printedParam === 'false' || printedParam === '0') {
        if (emp.printCount && emp.printCount > 0) return false;
      }
      if (hasPhotoParam === 'true' || hasPhotoParam === '1') {
        if (!emp.hasPhoto) return false;
      } else if (hasPhotoParam === 'false' || hasPhotoParam === '0') {
        if (emp.hasPhoto) return false;
      }
      return true;
    });

    const total = filtered.length;
    const rawLimitStr = getQueryString(req, 'limit');
    const rawLimit = rawLimitStr ? Number(rawLimitStr) : 0;
    const limit =
      !Number.isNaN(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 5000) : 0;
    const rawPageStr = getQueryString(req, 'page');
    const rawPage = rawPageStr ? Number(rawPageStr) : 1;
    const page = !Number.isNaN(rawPage) && rawPage > 0 ? rawPage : 1;

    const sliced =
      limit > 0
        ? filtered.slice((page - 1) * limit, (page - 1) * limit + limit)
        : filtered;

    const data = sliced.map(({ _sortMs, ...item }) => {
      if (!includePhoto) {
        return {
          ...item,
          photoUrl: '',
        };
      }
      return item;
    });

    res.status(200).json({
      success: true,
      company:
        'VIETSUN ĐỒNG NAI - CHI NHÁNH CÔNG TY CỔ PHẦN ĐẦU TƯ MẶT TRỜI VIỆT',
      total,
      count: data.length,
      page: limit > 0 ? page : 1,
      limit: limit > 0 ? limit : total,
      totalPages: limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1,
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Lỗi máy chủ khi truy xuất danh sách nhân viên.',
    });
  }
}
