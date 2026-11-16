/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import {
  LayoutDashboard,
  Users,
  Palette,
  Printer,
  History,
  Settings,
  FileSpreadsheet,
  ScanFace,
} from 'lucide-react';
import {
  db,
  handleFirestoreError,
  OperationType,
} from './firebase';
import {
  ActiveTab,
  AppSettings,
  CardTemplate,
  DEFAULT_CARD_TEMPLATES,
  Department,
  Employee,
  ImportHistory,
  OFFICIAL_VIETSUN_FAVICON,
  OFFICIAL_VIETSUN_LOGO,
  PrintHistory,
  SAMPLE_EMPLOYEES_SEED,
} from './types';
import { DashboardView } from './components/DashboardView';
import { EmployeeManagementView } from './components/EmployeeManagementView';
import { CardDesignerView } from './components/CardDesignerView';
import { BatchPrintView } from './components/BatchPrintView';
import { HistoryView } from './components/HistoryView';
import { SettingsView } from './components/SettingsView';
import {
  ExcelImportModal,
  ParsedExcelRow,
} from './components/ExcelImportModal';
import { FaceCropStudioView } from './components/FaceCropStudioView';
import { triggerBrowserCtrlP } from './utils/nativePrint';

const WORKSPACE_ID = 'vietsun_workspace';

function generateSafeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function getEmployeeCreatedAtMs(emp: Employee): number {
  const c = emp.createdAt as
    | number
    | string
    | { toMillis?: () => number; seconds?: number; nanoseconds?: number }
    | undefined;
  if (typeof c === 'number' && !Number.isNaN(c)) return c;
  if (typeof c === 'string') {
    const parsed = Date.parse(c);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (c && typeof c === 'object') {
    if (typeof c.toMillis === 'function') return c.toMillis();
    if (typeof c.seconds === 'number') {
      return c.seconds * 1000 + Math.floor((c.nanoseconds || 0) / 1e6);
    }
  }
  const idMatch = emp.id?.match(/^emp_(\d{10,15})_/);
  if (idMatch) {
    return parseInt(idMatch[1], 10);
  }
  return 0;
}

function sortEmployeesNewestFirst(a: Employee, b: Employee): number {
  const timeDiff = getEmployeeCreatedAtMs(b) - getEmployeeCreatedAtMs(a);
  if (timeDiff !== 0) return timeDiff;
  return a.msnv.localeCompare(b.msnv, undefined, { numeric: true });
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  // Firestore synced state (no login required — personal self-use workspace)
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [templates, setTemplates] = useState<CardTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [importLogs, setImportLogs] = useState<ImportHistory[]>([]);
  const [printLogs, setPrintLogs] = useState<PrintHistory[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(() => {
    try {
      const raw = localStorage.getItem('vietsun_system_settings_v1');
      if (raw) {
        return JSON.parse(raw) as AppSettings;
      }
    } catch {
      // ignore storage read error
    }
    return null;
  });

  // Selected employees for batch printing
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(
    new Set()
  );

  const hasBootstrappedRef = useRef<boolean>(false);

  // Synchronously switch to the print sheet view and open the native browser Ctrl+P dialog
  const handleOpenPrintDialog = (specificIds?: string[]) => {
    flushSync(() => {
      if (specificIds && specificIds.length > 0) {
        setSelectedEmployeeIds(new Set(specificIds));
      } else if (selectedEmployeeIds.size === 0) {
        setSelectedEmployeeIds(new Set(employees.map((e) => e.id)));
      }
      setIsImportModalOpen(false);
      setActiveTab('print');
    });
    triggerBrowserCtrlP();
  };

  // Load workspace data once from Firestore using getDocs (no continuous realtime connection)
  const loadWorkspaceData = async () => {
    try {
      const [empSnap, deptSnap, tplSnap, impSnap, prtSnap, setSnap] =
        await Promise.all([
          getDocs(
            query(
              collection(db, 'employees'),
              where('ownerId', '==', WORKSPACE_ID)
            )
          ),
          getDocs(
            query(
              collection(db, 'departments'),
              where('ownerId', '==', WORKSPACE_ID)
            )
          ),
          getDocs(
            query(
              collection(db, 'templates'),
              where('ownerId', '==', WORKSPACE_ID)
            )
          ),
          getDocs(
            query(
              collection(db, 'import_logs'),
              where('ownerId', '==', WORKSPACE_ID)
            )
          ),
          getDocs(
            query(
              collection(db, 'print_logs'),
              where('ownerId', '==', WORKSPACE_ID)
            )
          ),
          getDocs(
            query(
              collection(db, 'settings'),
              where('ownerId', '==', WORKSPACE_ID)
            )
          ),
        ]);

      if (tplSnap.empty && !hasBootstrappedRef.current) {
        hasBootstrappedRef.current = true;
        await bootstrapInitialWorkspace();
        return;
      }

      // Mark all existing employees in database as printed 1 time ("Danh sách nhân viên giờ bạn sửa lại database đánh dấu là đã in 1 lần đi tại đây là danh sách nhân viên đã vào làm và in thẻ rồi")
      const allCurrentlyUnprinted =
        empSnap.docs.length > 0 &&
        empSnap.docs.every((d) => {
          const data = d.data() as Omit<Employee, 'id'>;
          return !data.printCount || data.printCount === 0;
        });

      const shouldMarkAllPrintedOnce =
        (typeof window !== 'undefined' &&
          localStorage.getItem('vietsun_mark_all_employees_printed_once_v1') !==
            'done') ||
        allCurrentlyUnprinted;

      if (shouldMarkAllPrintedOnce && empSnap.docs.length > 0) {
        if (typeof window !== 'undefined') {
          localStorage.setItem(
            'vietsun_mark_all_employees_printed_once_v1',
            'done'
          );
        }
        const todayStr = new Date().toLocaleDateString('vi-VN');
        const docsToUpdate = empSnap.docs.filter((d) => {
          const data = d.data() as Omit<Employee, 'id'>;
          return !data.printCount || data.printCount < 1;
        });

        const CHUNK_SIZE = 400;
        for (let i = 0; i < docsToUpdate.length; i += CHUNK_SIZE) {
          const chunk = docsToUpdate.slice(i, i + CHUNK_SIZE);
          const batch = writeBatch(db);
          chunk.forEach((d) => {
            const data = d.data() as Omit<Employee, 'id'>;
            batch.update(doc(db, 'employees', d.id), {
              printCount: 1,
              lastPrintedAt: data.lastPrintedAt || data.joinDate || todayStr,
              updatedAt: serverTimestamp(),
            });
          });
          await batch.commit();
        }
      }

      // 1. Employees (Clean up any leftover 06868 / TÊN NHÂN VIÊN test card record from database)
      const shouldCleanTest06868 =
        typeof window !== 'undefined' &&
        localStorage.getItem('vietsun_cleanup_test_06868_v1') !== 'done';
      if (shouldCleanTest06868 && typeof window !== 'undefined') {
        localStorage.setItem('vietsun_cleanup_test_06868_v1', 'done');
      }

      const todayFallback = new Date().toLocaleDateString('vi-VN');
      const empList: Employee[] = [];
      for (const d of empSnap.docs) {
        const raw = d.data() as Omit<Employee, 'id'>;
        const isTestDemoCard =
          raw.msnv?.trim() === '06868' ||
          raw.fullName?.trim().toUpperCase() === 'TÊN NHÂN VIÊN';

        if (isTestDemoCard && shouldCleanTest06868) {
          deleteDoc(doc(db, 'employees', d.id)).catch(() => {});
          continue;
        }

        const effectivePrintCount = shouldMarkAllPrintedOnce
          ? Math.max(1, raw.printCount || 0)
          : raw.printCount || 0;
        const effectiveLastPrintedAt = shouldMarkAllPrintedOnce
          ? raw.lastPrintedAt || raw.joinDate || todayFallback
          : raw.lastPrintedAt || '';

        empList.push({
          id: d.id,
          ...raw,
          printCount: effectivePrintCount,
          lastPrintedAt: effectiveLastPrintedAt,
        });
      }
      empList.sort(sortEmployeesNewestFirst);
      setEmployees(empList);

      // 1b. Departments (Seed from existing employees on first run if departments collection is empty)
      let deptList: Department[] = deptSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Department, 'id'>),
      }));

      if (deptList.length === 0) {
        const uniqueNames = new Set<string>();
        empList.forEach((e) => {
          const clean = e.department?.trim();
          if (clean) uniqueNames.add(clean);
        });
        if (uniqueNames.size === 0) {
          [
            'BGĐ',
            'BP. Bảo trì vận hành',
            'BP. Hành chính - Nhân sự',
            'BP. Kế toán - Tài chính',
            'BP. Sản xuất - Kỹ thuật',
            'BP. Kho vận - Logistics',
            'BP. Kiểm soát chất lượng (QC)',
          ].forEach((n) => uniqueNames.add(n));
        }
        const seedBatch = writeBatch(db);
        const seededDepts: Department[] = [];
        Array.from(uniqueNames)
          .sort((a, b) => a.localeCompare(b, 'vi'))
          .forEach((name, idx) => {
            const deptId = `dept_vietsun_${idx + 1}_${Date.now()}`;
            const deptObj: Department = {
              id: deptId,
              name: name.slice(0, 120),
              ownerId: WORKSPACE_ID,
            };
            seededDepts.push(deptObj);
            seedBatch.set(doc(db, 'departments', deptId), {
              name: deptObj.name,
              ownerId: WORKSPACE_ID,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          });
        await seedBatch.commit().catch(() => {});
        deptList = seededDepts;
      } else {
        deptList.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      }
      setDepartments(deptList);

      // 2. Templates
      const tplList: CardTemplate[] = tplSnap.docs.map((d) => {
        const data = d.data() as Omit<CardTemplate, 'id'>;
        const normalizedPhotoBg =
          !data.photoBgColor ||
          data.photoBgColor === '#1d4ed8' ||
          data.photoBgColor === '#2563eb'
            ? '#ffffff'
            : data.photoBgColor;
        return {
          id: d.id,
          ...data,
          logoUrl: data.logoUrl || OFFICIAL_VIETSUN_LOGO,
          photoBgColor: normalizedPhotoBg,
        };
      });
      setTemplates(tplList);
      if (tplList.length > 0) {
        setSelectedTemplateId((prev) => {
          if (prev && tplList.some((t) => t.id === prev)) return prev;
          const def = tplList.find((t) => t.isDefault) || tplList[0];
          return def.id;
        });
      }

      // 3. Import Logs
      const impList: ImportHistory[] = impSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ImportHistory, 'id'>),
      }));
      setImportLogs(impList);

      // 4. Print Logs
      const prtList: PrintHistory[] = prtSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<PrintHistory, 'id'>),
      }));
      setPrintLogs(prtList);

      // 5. Settings
      if (!setSnap.empty) {
        const d = setSnap.docs[0];
        const data = d.data() as Omit<AppSettings, 'id'>;
        const loadedSettings: AppSettings = {
          id: d.id,
          ...data,
          logoUrl: data.logoUrl || OFFICIAL_VIETSUN_LOGO,
        };
        setSettings(loadedSettings);
        try {
          localStorage.setItem(
            'vietsun_system_settings_v1',
            JSON.stringify(loadedSettings)
          );
        } catch {
          // ignore storage write error
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'workspace');
    }
  };

  useEffect(() => {
    void loadWorkspaceData();
  }, []);

  // Bootstrap default templates, settings, and sample VietSun employees on first run
  const bootstrapInitialWorkspace = async () => {
    try {
      const batch = writeBatch(db);
      const seededTemplates: CardTemplate[] = [];
      const seededEmployees: Employee[] = [];

      // 1. Seed 3 Default Card Templates with official VietSun logo
      DEFAULT_CARD_TEMPLATES.forEach((tpl, idx) => {
        const tplId = `tpl_vietsun_${idx + 1}`;
        const tplRecord: CardTemplate = {
          id: tplId,
          ...tpl,
          logoUrl: OFFICIAL_VIETSUN_LOGO,
          ownerId: WORKSPACE_ID,
        };
        seededTemplates.push(tplRecord);
        batch.set(doc(db, 'templates', tplId), {
          ...tpl,
          logoUrl: OFFICIAL_VIETSUN_LOGO,
          ownerId: WORKSPACE_ID,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      // 2. Seed Default Settings
      const settingId = 'settings_vietsun_main';
      const defaultSettings: AppSettings = {
        id: settingId,
        companyName: 'CHI NHÁNH CÔNG TY CỔ PHẦN',
        companyBranch: 'VIETSUN ĐỒNG NAI',
        companySubName: 'ĐẦU TƯ MẶT TRỜI VIỆT',
        logoUrl: OFFICIAL_VIETSUN_LOGO,
        defaultPaperSize: 'A4',
        defaultCols: 2,
        defaultRows: 4,
        defaultGapMm: 4,
        defaultMarginMm: 10,
        cardWidthMm: 85.6,
        cardHeightMm: 54,
        ownerId: WORKSPACE_ID,
      };
      batch.set(doc(db, 'settings', settingId), {
        companyName: defaultSettings.companyName,
        companyBranch: defaultSettings.companyBranch,
        companySubName: defaultSettings.companySubName,
        logoUrl: defaultSettings.logoUrl,
        defaultPaperSize: defaultSettings.defaultPaperSize,
        defaultCols: defaultSettings.defaultCols,
        defaultRows: defaultSettings.defaultRows,
        defaultGapMm: defaultSettings.defaultGapMm,
        defaultMarginMm: defaultSettings.defaultMarginMm,
        cardWidthMm: defaultSettings.cardWidthMm,
        cardHeightMm: defaultSettings.cardHeightMm,
        ownerId: WORKSPACE_ID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 3. Seed Sample Employees (including Trương Minh Hiếu - 90993)
      SAMPLE_EMPLOYEES_SEED.forEach((emp, idx) => {
        const empId = `emp_vietsun_${idx + 1}`;
        seededEmployees.push({
          id: empId,
          ...emp,
          ownerId: WORKSPACE_ID,
        });
        batch.set(doc(db, 'employees', empId), {
          ...emp,
          ownerId: WORKSPACE_ID,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      await batch.commit();

      setTemplates(seededTemplates);
      if (seededTemplates.length > 0) {
        const def =
          seededTemplates.find((t) => t.isDefault) || seededTemplates[0];
        setSelectedTemplateId(def.id);
      }
      setSettings(defaultSettings);
      seededEmployees.sort(sortEmployeesNewestFirst);
      setEmployees(seededEmployees);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'bootstrap');
    }
  };

  const handleSeedSampleEmployees = async () => {
    try {
      const batch = writeBatch(db);
      const existingMsnv = new Set(
        employees.map((e) => e.msnv.trim().toLowerCase())
      );
      const addedList: Employee[] = [];
      SAMPLE_EMPLOYEES_SEED.forEach((emp) => {
        if (!existingMsnv.has(emp.msnv.toLowerCase())) {
          const id = generateSafeId('emp');
          addedList.push({
            id,
            ...emp,
            ownerId: WORKSPACE_ID,
          });
          batch.set(doc(db, 'employees', id), {
            ...emp,
            ownerId: WORKSPACE_ID,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      });
      if (addedList.length > 0) {
        setEmployees((prev) => {
          const next = [...addedList, ...prev];
          next.sort(sortEmployeesNewestFirst);
          return next;
        });
        await batch.commit();
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'employees');
    }
  };

  // Employee CRUD Handlers
  const handleAddEmployee = async (data: {
    msnv: string;
    fullName: string;
    department: string;
    joinDate: string;
    photoUrl: string;
  }): Promise<string> => {
    const id = generateSafeId('emp');
    const nowMs = Date.now();
    const newEmp: Employee = {
      id,
      msnv: data.msnv.slice(0, 50),
      fullName: data.fullName.slice(0, 120),
      department: data.department.slice(0, 120),
      joinDate: data.joinDate.slice(0, 30),
      photoUrl: data.photoUrl.slice(0, 500000),
      printCount: 0,
      lastPrintedAt: '',
      ownerId: WORKSPACE_ID,
      createdAt: nowMs,
      updatedAt: nowMs,
    };
    flushSync(() => {
      setEmployees((prev) => {
        const next = [newEmp, ...prev];
        next.sort(sortEmployeesNewestFirst);
        return next;
      });
    });
    try {
      await setDoc(doc(db, 'employees', id), {
        msnv: newEmp.msnv,
        fullName: newEmp.fullName,
        department: newEmp.department,
        joinDate: newEmp.joinDate,
        photoUrl: newEmp.photoUrl,
        printCount: 0,
        lastPrintedAt: '',
        ownerId: WORKSPACE_ID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `employees/${id}`);
    }
    return id;
  };

  const handleUpdateEmployee = async (
    id: string,
    data: {
      msnv: string;
      fullName: string;
      department: string;
      joinDate: string;
      photoUrl: string;
    }
  ) => {
    const updatedFields = {
      msnv: data.msnv.slice(0, 50),
      fullName: data.fullName.slice(0, 120),
      department: data.department.slice(0, 120),
      joinDate: data.joinDate.slice(0, 30),
      photoUrl: data.photoUrl.slice(0, 500000),
    };
    setEmployees((prev) => {
      const next = prev.map((emp) =>
        emp.id === id ? { ...emp, ...updatedFields } : emp
      );
      next.sort(sortEmployeesNewestFirst);
      return next;
    });
    try {
      await updateDoc(doc(db, 'employees', id), {
        ...updatedFields,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `employees/${id}`);
    }
  };

  const handleDeleteEmployee = async (id: string) => {
    setEmployees((prev) => prev.filter((emp) => emp.id !== id));
    setSelectedEmployeeIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    try {
      await deleteDoc(doc(db, 'employees', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `employees/${id}`);
    }
  };

  const handleBatchDeleteEmployees = async (ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setEmployees((prev) => prev.filter((emp) => !idSet.has(emp.id)));
    setSelectedEmployeeIds(new Set());
    try {
      const CHUNK_SIZE = 400;
      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        chunk.forEach((id) => {
          batch.delete(doc(db, 'employees', id));
        });
        await batch.commit();
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'employees');
    }
  };

  // Department CRUD Handlers (Managed via Popup Modal in Employee Management)
  const handleAddDepartment = async (rawName: string): Promise<Department> => {
    const cleanName = rawName.trim().slice(0, 120);
    const existing = departments.find(
      (d) => d.name.trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (existing) return existing;

    const id = generateSafeId('dept');
    const newDept: Department = {
      id,
      name: cleanName,
      ownerId: WORKSPACE_ID,
    };
    setDepartments((prev) =>
      [...prev, newDept].sort((a, b) => a.name.localeCompare(b.name, 'vi'))
    );
    try {
      await setDoc(doc(db, 'departments', id), {
        name: cleanName,
        ownerId: WORKSPACE_ID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `departments/${id}`);
    }
    return newDept;
  };

  const handleUpdateDepartment = async (
    id: string,
    newRawName: string
  ): Promise<void> => {
    const cleanName = newRawName.trim().slice(0, 120);
    if (!cleanName) return;
    const oldDept = departments.find((d) => d.id === id);
    const oldName = oldDept?.name;

    setDepartments((prev) =>
      prev
        .map((d) => (d.id === id ? { ...d, name: cleanName } : d))
        .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
    );

    if (oldName && oldName !== cleanName) {
      setEmployees((prev) =>
        prev.map((emp) =>
          emp.department === oldName ? { ...emp, department: cleanName } : emp
        )
      );
    }

    try {
      await updateDoc(doc(db, 'departments', id), {
        name: cleanName,
        updatedAt: serverTimestamp(),
      });

      if (oldName && oldName !== cleanName) {
        const affectedEmps = employees.filter(
          (emp) => emp.department === oldName
        );
        const CHUNK_SIZE = 400;
        for (let i = 0; i < affectedEmps.length; i += CHUNK_SIZE) {
          const chunk = affectedEmps.slice(i, i + CHUNK_SIZE);
          const batch = writeBatch(db);
          chunk.forEach((emp) => {
            batch.update(doc(db, 'employees', emp.id), {
              department: cleanName,
              updatedAt: serverTimestamp(),
            });
          });
          await batch.commit();
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `departments/${id}`);
    }
  };

  const handleDeleteDepartment = async (id: string): Promise<void> => {
    setDepartments((prev) => prev.filter((d) => d.id !== id));
    try {
      await deleteDoc(doc(db, 'departments', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `departments/${id}`);
    }
  };

  // Excel Batch Import Handler (Supports chunked writes for large Excel files)
  const handleConfirmExcelImport = async (
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
    triggerPrintImmediately = false
  ): Promise<string[]> => {
    const importedIds: string[] = [];
    const preparedRows = rowsToImport.map((row) => {
      const resolvedId =
        row.status === 'valid_update' && row.existingEmployeeId
          ? row.existingEmployeeId
          : generateSafeId('emp');
      importedIds.push(resolvedId);
      return {
        ...row,
        resolvedId,
      };
    });

    const logId = generateSafeId('imp');
    const newImportLog: ImportHistory = {
      id: logId,
      fileName: (fileName || 'DanhSach.xlsx').slice(0, 200),
      importMode,
      totalRows: stats.totalRows,
      validCount: stats.validCount,
      errorCount: stats.errorCount,
      importedCount: stats.importedCount,
      updatedCount: stats.updatedCount,
      summaryNote: `Thêm mới ${stats.importedCount} NV, cập nhật ${stats.updatedCount} NV, bỏ qua ${stats.errorCount} dòng lỗi`,
      ownerId: WORKSPACE_ID,
      createdAt: new Date().toISOString(),
    };

    // Detect any new department names from Excel rows so they are automatically added to the managed departments list
    const existingDeptNamesLower = new Set(
      departments.map((d) => d.name.trim().toLowerCase())
    );
    const newDeptsToCreate: Department[] = [];
    preparedRows.forEach((row) => {
      const deptClean = (row.department || '').trim().slice(0, 120);
      if (
        deptClean &&
        !existingDeptNamesLower.has(deptClean.toLowerCase())
      ) {
        existingDeptNamesLower.add(deptClean.toLowerCase());
        newDeptsToCreate.push({
          id: generateSafeId('dept'),
          name: deptClean,
          ownerId: WORKSPACE_ID,
          createdAt: Date.now(),
        });
      }
    });

    // Immediately update local employees, departments, importLogs & selectedEmployeeIds state so UI reflects imported rows right away
    if (importedIds.length > 0) {
      flushSync(() => {
        const importBaseMs = Date.now();
        setEmployees((prev) => {
          const map = new Map<string, Employee>(prev.map((e) => [e.id, e]));
          preparedRows.forEach((row) => {
            const existing = map.get(row.resolvedId);
            map.set(row.resolvedId, {
              id: row.resolvedId,
              msnv: row.msnv.slice(0, 50),
              fullName: row.fullName.slice(0, 120),
              department: row.department.slice(0, 120),
              joinDate: row.joinDate.slice(0, 30),
              photoUrl: (row.photoUrl || existing?.photoUrl || '').slice(0, 500000),
              printCount: existing?.printCount || 0,
              lastPrintedAt: existing?.lastPrintedAt || '',
              ownerId: WORKSPACE_ID,
              createdAt: existing?.createdAt ?? importBaseMs,
              updatedAt: importBaseMs,
            });
          });
          return Array.from(map.values()).sort(sortEmployeesNewestFirst);
        });
        if (newDeptsToCreate.length > 0) {
          setDepartments((prev) =>
            [...prev, ...newDeptsToCreate].sort((a, b) =>
              a.name.localeCompare(b.name, 'vi')
            )
          );
        }
        setImportLogs((prev) => [newImportLog, ...prev]);
        setSelectedEmployeeIds(new Set(importedIds));
        if (triggerPrintImmediately) {
          setIsImportModalOpen(false);
          setActiveTab('print');
        }
      });
      if (triggerPrintImmediately) {
        triggerBrowserCtrlP();
      }
    }

    try {
      if (newDeptsToCreate.length > 0) {
        const deptBatch = writeBatch(db);
        newDeptsToCreate.forEach((dept) => {
          deptBatch.set(doc(db, 'departments', dept.id), {
            name: dept.name,
            ownerId: WORKSPACE_ID,
            createdAt: serverTimestamp(),
          });
        });
        await deptBatch.commit();
      }

      const chunkSize = 400;
      for (let i = 0; i < preparedRows.length; i += chunkSize) {
        const slice = preparedRows.slice(i, i + chunkSize);
        const batch = writeBatch(db);

        slice.forEach((row) => {
          if (row.status === 'valid_update' && row.existingEmployeeId) {
            const updatePayload: Record<string, unknown> = {
              msnv: row.msnv.slice(0, 50),
              fullName: row.fullName.slice(0, 120),
              department: row.department.slice(0, 120),
              joinDate: row.joinDate.slice(0, 30),
              updatedAt: serverTimestamp(),
            };
            if (row.photoUrl) {
              updatePayload.photoUrl = row.photoUrl.slice(0, 500000);
            }
            batch.update(doc(db, 'employees', row.resolvedId), updatePayload);
          } else if (row.status === 'valid_new') {
            batch.set(doc(db, 'employees', row.resolvedId), {
              msnv: row.msnv.slice(0, 50),
              fullName: row.fullName.slice(0, 120),
              department: row.department.slice(0, 120),
              joinDate: row.joinDate.slice(0, 30),
              photoUrl: (row.photoUrl || '').slice(0, 500000),
              printCount: 0,
              lastPrintedAt: '',
              ownerId: WORKSPACE_ID,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        });

        await batch.commit();
      }

      // Record Import History Log
      await setDoc(doc(db, 'import_logs', logId), {
        fileName: newImportLog.fileName,
        importMode: newImportLog.importMode,
        totalRows: newImportLog.totalRows,
        validCount: newImportLog.validCount,
        errorCount: newImportLog.errorCount,
        importedCount: newImportLog.importedCount,
        updatedCount: newImportLog.updatedCount,
        summaryNote: newImportLog.summaryNote,
        ownerId: WORKSPACE_ID,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'import_logs');
    }
    return importedIds;
  };

  // Template Save / Delete Handlers
  const handleSaveTemplate = async (template: CardTemplate, asNew: boolean) => {
    const id = asNew ? generateSafeId('tpl') : template.id;
    const cleanTemplate: CardTemplate = {
      id,
      name: template.name.slice(0, 100),
      layoutStyle: template.layoutStyle,
      orientation: template.orientation,
      primaryColor: template.primaryColor.slice(0, 30),
      secondaryColor: template.secondaryColor.slice(0, 30),
      backgroundColor: template.backgroundColor.slice(0, 30),
      textColor: template.textColor.slice(0, 30),
      borderColor: template.borderColor.slice(0, 30),
      fontFamily: template.fontFamily.slice(0, 80),
      companyBranch: template.companyBranch.slice(0, 120),
      companyNameLine1: template.companyNameLine1.slice(0, 120),
      companyNameLine2: template.companyNameLine2.slice(0, 120),
      companyTagline: template.companyTagline.slice(0, 100),
      logoText: template.logoText.slice(0, 60),
      logoUrl: (template.logoUrl || OFFICIAL_VIETSUN_LOGO).slice(0, 300000),
      showStamp: Boolean(template.showStamp),
      stampOpacity: Number(template.stampOpacity),
      stampOffsetX: Number(template.stampOffsetX),
      stampOffsetY: Number(template.stampOffsetY),
      nameFontSize: Number(template.nameFontSize),
      msnvFontSize: Number(template.msnvFontSize),
      deptFontSize: Number(template.deptFontSize),
      dateFontSize: Number(template.dateFontSize),
      headerFontSize: Number(template.headerFontSize),
      deptPrefix: template.deptPrefix.slice(0, 30),
      photoBgColor: template.photoBgColor.slice(0, 30),
      photoWidthPercent: Number(template.photoWidthPercent),
      nameOffsetY: Number(template.nameOffsetY),
      msnvOffsetY: Number(template.msnvOffsetY),
      deptOffsetY: Number(template.deptOffsetY),
      dateOffsetY: Number(template.dateOffsetY),
      backTitle: template.backTitle.slice(0, 120),
      backRules: template.backRules.slice(0, 1000),
      backAddress: template.backAddress.slice(0, 300),
      backPhone: template.backPhone.slice(0, 60),
      showQrOnBack: Boolean(template.showQrOnBack),
      isDefault: Boolean(template.isDefault),
      ownerId: WORKSPACE_ID,
    };

    const { id: _id, ...payloadBase } = cleanTemplate;
    const payload = {
      ...payloadBase,
      updatedAt: serverTimestamp(),
    };

    if (asNew) {
      setTemplates((prev) => [...prev, cleanTemplate]);
      setSelectedTemplateId(id);
    } else {
      setTemplates((prev) =>
        prev.map((t) => (t.id === id ? cleanTemplate : t))
      );
    }

    try {
      if (asNew) {
        await setDoc(doc(db, 'templates', id), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      } else {
        const { ownerId: _o, ...updateFields } = payload;
        await updateDoc(doc(db, 'templates', id), updateFields);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `templates/${id}`);
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (templates.length <= 1) return;
    setTemplates((prev) => {
      const remaining = prev.filter((t) => t.id !== templateId);
      if (selectedTemplateId === templateId && remaining.length > 0) {
        setSelectedTemplateId(remaining[0].id);
      }
      return remaining;
    });
    try {
      await deleteDoc(doc(db, 'templates', templateId));
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.DELETE,
        `templates/${templateId}`
      );
    }
  };

  // Record Print Job & Increment Employee Print Counts
  const handleRecordPrintJob = async (
    printedEmployees: Employee[],
    printMode: 'a4_grid' | 'cr80_direct' | 'pdf_export',
    templateName: string,
    totalPages: number,
    paperSize: string,
    duplex: boolean
  ) => {
    if (printedEmployees.length === 0) return;
    const todayStr = new Date().toLocaleDateString('vi-VN');
    const summary = printedEmployees
      .map((e) => `${e.msnv} - ${e.fullName}`)
      .join(', ')
      .slice(0, 1950);
    const logId = generateSafeId('prt');
    const printedIdSet = new Set(printedEmployees.map((e) => e.id));

    setEmployees((prev) =>
      prev.map((emp) =>
        printedIdSet.has(emp.id)
          ? {
              ...emp,
              printCount: (emp.printCount || 0) + 1,
              lastPrintedAt: todayStr,
            }
          : emp
      )
    );
    setPrintLogs((prev) => [
      {
        id: logId,
        printMode,
        templateName: templateName.slice(0, 100),
        totalCards: printedEmployees.length,
        totalPages: Math.max(1, totalPages),
        paperSize: paperSize.slice(0, 30),
        duplex: Boolean(duplex),
        employeeSummary: summary,
        ownerId: WORKSPACE_ID,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);

    try {
      const batch = writeBatch(db);

      printedEmployees.slice(0, 400).forEach((emp) => {
        batch.update(doc(db, 'employees', emp.id), {
          printCount: (emp.printCount || 0) + 1,
          lastPrintedAt: todayStr,
          updatedAt: serverTimestamp(),
        });
      });

      batch.set(doc(db, 'print_logs', logId), {
        printMode,
        templateName: templateName.slice(0, 100),
        totalCards: printedEmployees.length,
        totalPages: Math.max(1, totalPages),
        paperSize: paperSize.slice(0, 30),
        duplex: Boolean(duplex),
        employeeSummary: summary,
        ownerId: WORKSPACE_ID,
        createdAt: serverTimestamp(),
      });

      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'print_logs');
    }
  };

  // Clear All History (Import Logs, Print Logs, and Reset Employee Print Counts)
  const handleClearAllHistory = async () => {
    const currentImportLogs = [...importLogs];
    const currentPrintLogs = [...printLogs];
    const printedEmps = employees.filter(
      (e) => (e.printCount || 0) > 0 || Boolean(e.lastPrintedAt)
    );

    setImportLogs([]);
    setPrintLogs([]);
    setEmployees((prev) =>
      prev.map((emp) => ({
        ...emp,
        printCount: 0,
        lastPrintedAt: '',
      }))
    );

    try {
      const batch = writeBatch(db);
      let ops = 0;

      currentImportLogs.forEach((log) => {
        if (ops < 450) {
          batch.delete(doc(db, 'import_logs', log.id));
          ops++;
        }
      });

      currentPrintLogs.forEach((log) => {
        if (ops < 450) {
          batch.delete(doc(db, 'print_logs', log.id));
          ops++;
        }
      });

      printedEmps.forEach((emp) => {
        if (ops < 450) {
          batch.update(doc(db, 'employees', emp.id), {
            printCount: 0,
            lastPrintedAt: '',
            updatedAt: serverTimestamp(),
          });
          ops++;
        }
      });

      if (ops > 0) {
        await batch.commit();
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'history');
    }
  };

  // Save System Settings
  const handleSaveSettings = async (updated: AppSettings) => {
    const docId =
      updated.id && updated.id !== 'default-settings'
        ? updated.id
        : 'settings_vietsun_main';
    const nextSettings: AppSettings = {
      id: docId,
      companyName: updated.companyName.slice(0, 150),
      companyBranch: updated.companyBranch.slice(0, 150),
      companySubName: updated.companySubName.slice(0, 150),
      logoUrl: (updated.logoUrl || OFFICIAL_VIETSUN_LOGO).slice(0, 300000),
      defaultPaperSize: updated.defaultPaperSize,
      defaultCols: Number(updated.defaultCols),
      defaultRows: Number(updated.defaultRows),
      defaultGapMm: Number(updated.defaultGapMm),
      defaultMarginMm: Number(updated.defaultMarginMm),
      cardWidthMm: Number(updated.cardWidthMm),
      cardHeightMm: Number(updated.cardHeightMm),
      ownerId: WORKSPACE_ID,
    };
    setSettings(nextSettings);
    try {
      localStorage.setItem(
        'vietsun_system_settings_v1',
        JSON.stringify(nextSettings)
      );
    } catch {
      // ignore storage write error
    }
    try {
      const { id: _id, ...settingsFields } = nextSettings;
      await setDoc(
        doc(db, 'settings', docId),
        {
          ...settingsFields,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `settings/${docId}`);
    }
  };

  const activeTemplate: CardTemplate =
    templates.find((t) => t.id === selectedTemplateId) ||
    templates[0] || {
      id: 'default-fallback',
      ownerId: WORKSPACE_ID,
      ...DEFAULT_CARD_TEMPLATES[0],
    };

  const activeSettings: AppSettings = settings || {
    id: 'settings_vietsun_main',
    companyName: 'CHI NHÁNH CÔNG TY CỔ PHẦN',
    companyBranch: 'VIETSUN ĐỒNG NAI',
    companySubName: 'ĐẦU TƯ MẶT TRỜI VIỆT',
    logoUrl: OFFICIAL_VIETSUN_LOGO,
    defaultPaperSize: 'A4',
    defaultCols: 2,
    defaultRows: 4,
    defaultGapMm: 4,
    defaultMarginMm: 10,
    cardWidthMm: 85.6,
    cardHeightMm: 54,
    ownerId: WORKSPACE_ID,
  };

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white print:min-h-0 flex flex-col print:block">
      {/* Top Navigation Bar (Hidden when printing) */}
      <header className="no-print bg-white text-slate-900 border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-5 min-h-14 py-1.5 flex flex-wrap items-center justify-between gap-2">
          {/* Zone 1: Brand Title with uploaded Favicon & VietSun Logo */}
          <div
            onClick={() => setActiveTab('dashboard')}
            className="flex items-center gap-2 shrink-0 cursor-pointer"
          >
            <img
              src={OFFICIAL_VIETSUN_FAVICON}
              alt="VietSun Icon"
              referrerPolicy="no-referrer"
              className="w-7 h-7 object-contain shrink-0"
            />
            <img
              src={OFFICIAL_VIETSUN_LOGO}
              alt="VIETSUN Logo"
              referrerPolicy="no-referrer"
              className="h-7 w-auto object-contain hidden sm:block"
            />
            <span className="font-bold text-xs text-slate-800 whitespace-nowrap border-l border-slate-200 pl-2.5 hidden xl:inline">
              Quản Lý &amp; In Thẻ NV
            </span>
          </div>

          {/* Zone 2: Main Navigation Links (Compact, No Horizontal Scrollbar) */}
          <nav className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activeTab === 'dashboard'
                  ? 'bg-blue-700 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              Dashboard
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('employees')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activeTab === 'employees'
                  ? 'bg-blue-700 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Nhân viên
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('face_crop')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activeTab === 'face_crop'
                  ? 'bg-blue-700 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <ScanFace className="w-3.5 h-3.5" />
              Cắt ảnh 3×4
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('designer')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activeTab === 'designer'
                  ? 'bg-blue-700 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              Thiết kế thẻ
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('print')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activeTab === 'print'
                  ? 'bg-blue-700 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Printer className="w-3.5 h-3.5" />
              In thẻ
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activeTab === 'history'
                  ? 'bg-blue-700 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              Lịch sử
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activeTab === 'settings'
                  ? 'bg-blue-700 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              Cài đặt
            </button>
          </nav>

          {/* Zone 3: Quick Import Excel Action */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer transition-colors whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              IMPORT EXCEL
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 print:p-0 print:m-0 print:max-w-none">
        {activeTab === 'dashboard' && (
          <DashboardView
            employees={employees}
            templates={templates}
            selectedTemplate={activeTemplate}
            importLogs={importLogs}
            printLogs={printLogs}
            onNavigate={setActiveTab}
            onOpenImportModal={() => setIsImportModalOpen(true)}
            onPrintDepartment={(deptName) => {
              const deptIds = employees
                .filter((e) => e.department === deptName)
                .map((e) => e.id);
              handleOpenPrintDialog(deptIds);
            }}
            onSeedSampleEmployees={handleSeedSampleEmployees}
            onOpenPrintDialog={handleOpenPrintDialog}
          />
        )}

        {activeTab === 'employees' && (
          <EmployeeManagementView
            employees={employees}
            departments={departments}
            selectedTemplate={activeTemplate}
            selectedEmployeeIds={selectedEmployeeIds}
            onChangeSelectedIds={setSelectedEmployeeIds}
            onAddEmployee={handleAddEmployee}
            onUpdateEmployee={handleUpdateEmployee}
            onDeleteEmployee={handleDeleteEmployee}
            onBatchDeleteEmployees={handleBatchDeleteEmployees}
            onAddDepartment={handleAddDepartment}
            onUpdateDepartment={handleUpdateDepartment}
            onDeleteDepartment={handleDeleteDepartment}
            onOpenImportModal={() => setIsImportModalOpen(true)}
            onGoToBatchPrint={() => setActiveTab('print')}
            onOpenPrintDialog={handleOpenPrintDialog}
            onSeedSampleEmployees={handleSeedSampleEmployees}
          />
        )}

        {activeTab === 'face_crop' && (
          <FaceCropStudioView
            employees={employees}
            selectedTemplate={activeTemplate}
            onUpdateEmployeePhoto={(emp, photoUrl) =>
              handleUpdateEmployee(emp.id, {
                msnv: emp.msnv,
                fullName: emp.fullName,
                department: emp.department,
                joinDate: emp.joinDate,
                photoUrl,
              })
            }
            onOpenPrintDialog={handleOpenPrintDialog}
          />
        )}

        {activeTab === 'designer' && (
          <CardDesignerView
            templates={templates}
            selectedTemplate={activeTemplate}
            onSelectTemplate={(tpl) => setSelectedTemplateId(tpl.id)}
            onSaveTemplate={handleSaveTemplate}
            onDeleteTemplate={handleDeleteTemplate}
            employees={employees}
          />
        )}

        {activeTab === 'print' && (
          <BatchPrintView
            employees={employees}
            departments={departments}
            templates={templates}
            selectedTemplate={activeTemplate}
            onSelectTemplate={(tpl) => setSelectedTemplateId(tpl.id)}
            selectedEmployeeIds={selectedEmployeeIds}
            onChangeSelectedIds={setSelectedEmployeeIds}
            settings={activeSettings}
            onSaveSettings={handleSaveSettings}
            onAddEmployee={handleAddEmployee}
            onUpdateEmployeePhoto={(emp, photoUrl) =>
              handleUpdateEmployee(emp.id, {
                msnv: emp.msnv,
                fullName: emp.fullName,
                department: emp.department,
                joinDate: emp.joinDate,
                photoUrl,
              })
            }
            onRecordPrintJob={handleRecordPrintJob}
            onOpenPrintDialog={handleOpenPrintDialog}
          />
        )}

        {activeTab === 'history' && (
          <HistoryView
            employees={employees}
            importLogs={importLogs}
            printLogs={printLogs}
            onReprintEmployee={(empId) => {
              handleOpenPrintDialog([empId]);
            }}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            settings={activeSettings}
            onSaveSettings={handleSaveSettings}
          />
        )}
      </main>

      {/* Excel Batch Import Modal */}
      <ExcelImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        existingEmployees={employees}
        onConfirmImport={handleConfirmExcelImport}
        onGoToPrintWithIds={(ids) => {
          handleOpenPrintDialog(ids);
        }}
      />
    </div>
  );
}
