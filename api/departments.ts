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

interface VercelReq {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
}

interface VercelRes {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => VercelRes;
  json: (body: unknown) => void;
  end: () => void;
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
    const [deptSnap, empSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, 'departments'),
          where('ownerId', '==', WORKSPACE_ID)
        )
      ),
      getDocs(
        query(collection(db, 'employees'), where('ownerId', '==', WORKSPACE_ID))
      ),
    ]);

    const countByDept = new Map<string, number>();
    empSnap.docs.forEach((d) => {
      const raw = d.data() as { department?: string };
      const dName = (raw.department || '').trim();
      if (dName) {
        countByDept.set(dName, (countByDept.get(dName) || 0) + 1);
      }
    });

    const departments = deptSnap.docs.map((d) => {
      const raw = d.data() as { name?: string };
      const name = (raw.name || '').trim();
      return {
        id: d.id,
        name,
        employeeCount: countByDept.get(name) || 0,
      };
    });

    const existingNamesLower = new Set(
      departments.map((d) => d.name.toLowerCase())
    );
    countByDept.forEach((count, deptName) => {
      if (!existingNamesLower.has(deptName.toLowerCase())) {
        existingNamesLower.add(deptName.toLowerCase());
        departments.push({
          id: `dept_${deptName}`,
          name: deptName,
          employeeCount: count,
        });
      }
    });

    departments.sort((a, b) => a.name.localeCompare(b.name, 'vi'));

    res.status(200).json({
      success: true,
      total: departments.length,
      totalEmployees: empSnap.size,
      data: departments,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Lỗi máy chủ khi truy xuất danh sách bộ phận.',
    });
  }
}
