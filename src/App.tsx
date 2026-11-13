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

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  // Firestore synced state (no login required — personal self-use workspace)
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [templates, setTemplates] = useState<CardTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [importLogs, setImportLogs] = useState<ImportHistory[]>([]);
  const [printLogs, setPrintLogs] = useState<PrintHistory[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);

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
      const [empSnap, tplSnap, impSnap, prtSnap, setSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, 'employees'),
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

      // 1. Employees
      const empList: Employee[] = empSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Employee, 'id'>),
      }));
      empList.sort((a, b) =>
        a.msnv.localeCompare(b.msnv, undefined, { numeric: true })
      );
      setEmployees(empList);

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
        setSettings({
          id: d.id,
          ...data,
          logoUrl: data.logoUrl || OFFICIAL_VIETSUN_LOGO,
        });
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
      seededEmployees.sort((a, b) =>
        a.msnv.localeCompare(b.msnv, undefined, { numeric: true })
      );
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
          const next = [...prev, ...addedList];
          next.sort((a, b) =>
            a.msnv.localeCompare(b.msnv, undefined, { numeric: true })
          );
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
    };
    flushSync(() => {
      setEmployees((prev) => {
        const next = [...prev, newEmp];
        next.sort((a, b) =>
          a.msnv.localeCompare(b.msnv, undefined, { numeric: true })
        );
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
      next.sort((a, b) =>
        a.msnv.localeCompare(b.msnv, undefined, { numeric: true })
      );
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
      const batch = writeBatch(db);
      ids.forEach((id) => {
        batch.delete(doc(db, 'employees', id));
      });
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'employees');
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

    // Immediately update local employees, importLogs & selectedEmployeeIds state so UI reflects imported rows right away
    if (importedIds.length > 0) {
      flushSync(() => {
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
            });
          });
          return Array.from(map.values()).sort((a, b) =>
            a.msnv.localeCompare(b.msnv, undefined, { numeric: true })
          );
        });
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
    defaultGapMm: 0,
    defaultMarginMm: 10,
    cardWidthMm: 100,
    cardHeightMm: 50,
    ownerId: WORKSPACE_ID,
  };

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white print:min-h-0 flex flex-col print:block">
      {/* Top Navigation Bar (Hidden when printing) */}
      <header className="no-print bg-white text-slate-900 border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-6">
          {/* Zone 1: Brand Title with uploaded Favicon & VietSun Logo */}
          <div
            onClick={() => setActiveTab('dashboard')}
            className="flex items-center gap-3 shrink-0 cursor-pointer"
          >
            <img
              src={OFFICIAL_VIETSUN_FAVICON}
              alt="VietSun Icon"
              referrerPolicy="no-referrer"
              className="w-8 h-8 object-contain shrink-0"
            />
            <img
              src={OFFICIAL_VIETSUN_LOGO}
              alt="VIETSUN Logo"
              referrerPolicy="no-referrer"
              className="h-8 w-auto object-contain hidden sm:block"
            />
            <span className="font-bold text-sm text-slate-800 whitespace-nowrap border-l border-slate-200 pl-3">
              Quản Lý & In Thẻ Nhân Viên
            </span>
          </div>

          {/* Zone 2: 6 Main Navigation Links */}
          <nav className="flex items-center gap-1 overflow-x-auto py-1">
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
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
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activeTab === 'employees'
                  ? 'bg-blue-700 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Quản lý nhân viên ({employees.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('face_crop')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activeTab === 'face_crop'
                  ? 'bg-blue-700 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <ScanFace className="w-3.5 h-3.5" />
              Cắt ảnh 3×4 AI
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('designer')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
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
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activeTab === 'print'
                  ? 'bg-blue-700 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Printer className="w-3.5 h-3.5" />
              In thẻ hàng loạt
              {selectedEmployeeIds.size > 0 && (
                <span className="ml-0.5 font-mono-num font-bold">
                  ({selectedEmployeeIds.size})
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
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
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
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
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer transition-colors whitespace-nowrap shrink-0"
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
            selectedTemplate={activeTemplate}
            selectedEmployeeIds={selectedEmployeeIds}
            onChangeSelectedIds={setSelectedEmployeeIds}
            onAddEmployee={handleAddEmployee}
            onUpdateEmployee={handleUpdateEmployee}
            onDeleteEmployee={handleDeleteEmployee}
            onBatchDeleteEmployees={handleBatchDeleteEmployees}
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
