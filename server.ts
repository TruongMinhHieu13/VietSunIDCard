import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WORKSPACE_ID = 'vietsun_workspace';

const firebaseApp =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

interface EmployeeRecord {
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

interface DepartmentRecord {
  id: string;
  name: string;
  ownerId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
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
    const raw = d.data() as Omit<EmployeeRecord, 'id'>;
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

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '10mb' }));

  // Enable CORS on all /api/* routes so external websites can integrate directly
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
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
    next();
  });

  /**
   * GET /api/health
   * Health check for external website integration
   */
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      success: true,
      service: 'VIETSUN ĐỒNG NAI - Employee Integration API',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /api/employees
   * Returns list of employees with optional filtering & pagination:
   * - ?search=... or ?q=... (filter by fullName or msnv, accent-insensitive)
   * - ?department=... (filter by department name)
   * - ?msnv=... (filter by single MSNV or comma-separated list of MSNVs, e.g. ?msnv=90993,00441)
   * - ?printed=true|false (filter by print status)
   * - ?hasPhoto=true|false (filter by whether employee has a 3x4 portrait photo)
   * - ?includePhoto=true|false (default: true; set false to exclude base64 photoUrl for lightweight response)
   * - ?page=1&limit=100 (optional pagination; if limit is omitted, returns all matching records)
   */
  app.get('/api/employees', async (req: Request, res: Response) => {
    try {
      const allEmployees = await fetchAllWorkspaceEmployees();

      const searchParam = String(
        req.query.search ?? req.query.q ?? ''
      ).trim();
      const departmentParam = String(req.query.department ?? '').trim();
      const msnvParam = String(req.query.msnv ?? '').trim();
      const printedParam = String(req.query.printed ?? '')
        .trim()
        .toLowerCase();
      const hasPhotoParam = String(req.query.hasPhoto ?? '')
        .trim()
        .toLowerCase();
      const includePhoto =
        String(req.query.includePhoto ?? 'true')
          .trim()
          .toLowerCase() !== 'false';

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
      const rawLimit = req.query.limit ? Number(req.query.limit) : 0;
      const limit =
        !Number.isNaN(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 5000) : 0;
      const rawPage = req.query.page ? Number(req.query.page) : 1;
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

      res.json({
        success: true,
        company: 'VIETSUN ĐỒNG NAI - CHI NHÁNH CÔNG TY CỔ PHẦN ĐẦU TƯ MẶT TRỜI VIỆT',
        total,
        count: data.length,
        page: limit > 0 ? page : 1,
        limit: limit > 0 ? limit : total,
        totalPages: limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1,
        data,
      });
    } catch (error) {
      console.error('Error in GET /api/employees:', error);
      res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Lỗi máy chủ khi truy xuất danh sách nhân viên.',
      });
    }
  });

  /**
   * GET /api/employees/:msnvOrId
   * Fetch a single employee by MSNV (e.g. /api/employees/90993) or Firestore Document ID
   */
  app.get('/api/employees/:msnvOrId', async (req: Request, res: Response) => {
    try {
      const key = String(req.params.msnvOrId || '')
        .trim()
        .toLowerCase();
      const includePhoto =
        String(req.query.includePhoto ?? 'true')
          .trim()
          .toLowerCase() !== 'false';

      const allEmployees = await fetchAllWorkspaceEmployees();
      const found = allEmployees.find(
        (emp) =>
          emp.msnv.trim().toLowerCase() === key ||
          emp.id.trim().toLowerCase() === key
      );

      if (!found) {
        res.status(404).json({
          success: false,
          error: `Không tìm thấy nhân viên với mã hoặc ID "${req.params.msnvOrId}".`,
        });
        return;
      }

      const { _sortMs, ...employeeData } = found;
      res.json({
        success: true,
        data: includePhoto
          ? employeeData
          : { ...employeeData, photoUrl: '' },
      });
    } catch (error) {
      console.error('Error in GET /api/employees/:msnvOrId:', error);
      res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Lỗi máy chủ khi truy xuất thông tin nhân viên.',
      });
    }
  });

  /**
   * GET /api/departments
   * Returns all managed departments along with employee counts per department
   */
  app.get('/api/departments', async (_req: Request, res: Response) => {
    try {
      const [deptSnap, allEmployees] = await Promise.all([
        getDocs(
          query(
            collection(db, 'departments'),
            where('ownerId', '==', WORKSPACE_ID)
          )
        ),
        fetchAllWorkspaceEmployees(),
      ]);

      const countByDept = new Map<string, number>();
      allEmployees.forEach((emp) => {
        const dName = emp.department.trim();
        if (dName) {
          countByDept.set(dName, (countByDept.get(dName) || 0) + 1);
        }
      });

      const departments = deptSnap.docs.map((d) => {
        const raw = d.data() as Omit<DepartmentRecord, 'id'>;
        const name = (raw.name || '').trim();
        return {
          id: d.id,
          name,
          employeeCount: countByDept.get(name) || 0,
        };
      });

      // Include any department present on employees if not yet in /departments collection
      const existingNamesLower = new Set(
        departments.map((d) => d.name.toLowerCase())
      );
      countByDept.forEach((count, deptName) => {
        if (!existingNamesLower.has(deptName.toLowerCase())) {
          existingNamesLower.add(deptName.toLowerCase());
          departments.push({
            id: `auto_${Buffer.from(deptName).toString('hex').slice(0, 12)}`,
            name: deptName,
            employeeCount: count,
          });
        }
      });

      departments.sort((a, b) => a.name.localeCompare(b.name, 'vi'));

      res.json({
        success: true,
        total: departments.length,
        totalEmployees: allEmployees.length,
        data: departments,
      });
    } catch (error) {
      console.error('Error in GET /api/departments:', error);
      res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Lỗi máy chủ khi truy xuất danh sách bộ phận.',
      });
    }
  });

  // Vite middleware for development / static assets for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `VietSun Server & Employee Integration API running on http://0.0.0.0:${PORT}`
    );
  });
}

startServer();
