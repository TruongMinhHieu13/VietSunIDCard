import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  ScanFace,
  Upload,
  Download,
  CheckCircle2,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  FlipHorizontal,
  Sun,
  Contrast,
  Sparkles,
  UserCheck,
  Printer,
  X,
  Image as ImageIcon,
  Wand2,
  Move,
  Users,
  Check,
  Search,
  Eye,
  Crop,
  AlertTriangle,
} from 'lucide-react';
import { CardTemplate, Employee } from '../types';
import {
  AutoCropMethod,
  CropTransformConfig,
  DetectedFaceBox,
  OUTPUT_3X4_HEIGHT_PX,
  OUTPUT_3X4_WIDTH_PX,
  computeIdCropConfigFromFace,
  detectFacesInImage,
  loadImageFromFile,
  matchEmployeeByPhotoFileName,
  renderCroppedIdPhotoToDataUrl,
  tryMethodB_TableColorBlockDeskew,
} from '../utils/faceDetectionCrop';
import { IdCardPreview } from './IdCardPreview';

interface QueuedPhotoItem {
  id: string;
  file: File;
  fileName: string;
  objectUrl: string;
  matchedEmployeeId?: string;
  methodUsed?: AutoCropMethod;
  needsReview?: boolean;
}

interface FaceCropStudioViewProps {
  employees: Employee[];
  selectedTemplate: CardTemplate;
  onUpdateEmployeePhoto: (emp: Employee, photoUrl: string) => Promise<void>;
  onOpenPrintDialog?: (employeeIds?: string[]) => void;
  /** Optional pre-selected employee when opened from a modal */
  initialTargetEmployee?: Employee | null;
  /** Optional callback when used inside a modal */
  onCloseModal?: () => void;
}

export const FaceCropStudioView: React.FC<FaceCropStudioViewProps> = ({
  employees,
  selectedTemplate,
  onUpdateEmployeePhoto,
  onOpenPrintDialog,
  initialTargetEmployee = null,
  onCloseModal,
}) => {
  // Photo queue & active photo state
  const [photoQueue, setPhotoQueue] = useState<QueuedPhotoItem[]>([]);
  const [activePhotoId, setActivePhotoId] = useState<string>('');
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);

  // AI Face Detection & Pipeline state
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [detectedFaces, setDetectedFaces] = useState<DetectedFaceBox[]>([]);
  const [detectedCardRect, setDetectedCardRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
    angleDeg?: number;
    method?: AutoCropMethod;
  } | null>(null);
  const [selectedFaceIndex, setSelectedFaceIndex] = useState<number>(0);

  // Default to 3x4 cm @ 300 DPI (354 x 472 px) as requested
  const [aspectMode, setAspectMode] = useState<'3x4' | '25x35'>('3x4');
  const currentAspectRatio = aspectMode === '3x4' ? 3 / 4 : 25 / 35;

  const [cropConfig, setCropConfig] = useState<CropTransformConfig>({
    centerX: 250,
    centerY: 250,
    scale: 1,
    baseCropHeight: 350,
    rotationDeg: 0,
    flipH: false,
    brightness: 100,
    contrast: 100,
    sharpen: true,
    aspectRatio: 3 / 4,
    methodUsed: 'A',
    needsReview: false,
  });

  // Interaction mode on canvas: 'move' (drag box / drag corners) or 'draw' (click & drag to draw a new 3x4 crop box)
  const [interactionMode, setInteractionMode] = useState<'move' | 'draw'>('move');

  // Live cropped DataURL (354 x 472 px @ 300 DPI)
  const [croppedDataUrl, setCroppedDataUrl] = useState<string>('');
  const [showBiometricGuides, setShowBiometricGuides] = useState<boolean>(true);
  const [showKeypointsOverlay, setShowKeypointsOverlay] = useState<boolean>(true);

  // Employee assignment state
  const [targetEmployeeId, setTargetEmployeeId] = useState<string>(
    initialTargetEmployee?.id || (employees[0]?.id ?? '')
  );
  const [empSearchQuery, setEmpSearchQuery] = useState<string>('');
  const [isSavingToEmp, setIsSavingToEmp] = useState<boolean>(false);
  const [isBatchProcessing, setIsBatchProcessing] = useState<boolean>(false);
  const [directMsnvProgress, setDirectMsnvProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'info' | 'warning';
    text: string;
  } | null>(null);

  // Pointer interaction state on source image canvas
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [activeDragType, setActiveDragType] = useState<
    'none' | 'pan' | 'resize' | 'draw_box'
  >('none');
  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    startCenterX: number;
    startCenterY: number;
    startEffectiveHeight: number;
    drawStartXImg: number;
    drawStartYImg: number;
  } | null>(null);

  useEffect(() => {
    if (initialTargetEmployee) {
      setTargetEmployeeId(initialTargetEmployee.id);
    } else if (!targetEmployeeId && employees.length > 0) {
      setTargetEmployeeId(employees[0].id);
    }
  }, [initialTargetEmployee, employees, targetEmployeeId]);

  const activePhotoItem = useMemo(
    () => photoQueue.find((item) => item.id === activePhotoId) || null,
    [photoQueue, activePhotoId]
  );

  const targetEmployee = useMemo(
    () => employees.find((e) => e.id === targetEmployeeId) || null,
    [employees, targetEmployeeId]
  );

  const filteredEmployees = useMemo(() => {
    const q = empSearchQuery.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) =>
        e.msnv.toLowerCase().includes(q) ||
        e.fullName.toLowerCase().includes(q) ||
        e.department.toLowerCase().includes(q)
    );
  }, [employees, empSearchQuery]);

  // Match filename with employee MSNV or Full Name automatically
  const findMatchingEmployeeByFileName = useCallback(
    (fileName: string): Employee | undefined => {
      return matchEmployeeByPhotoFileName(fileName, employees);
    },
    [employees]
  );

  // Execute the A -> B -> C pipeline on `img`
  const runFaceDetectionOnImage = useCallback(
    async (img: HTMLImageElement, ratio: number, photoId?: string) => {
      setIsDetecting(true);
      try {
        const {
          faces,
          detectedCardRect: cardRect,
          recommendedConfig,
        } = await detectFacesInImage(img);

        setDetectedFaces(faces);
        setDetectedCardRect(cardRect);
        setSelectedFaceIndex(0);

        const nextConfig: CropTransformConfig = {
          ...recommendedConfig,
          aspectRatio: ratio,
        };
        setCropConfig(nextConfig);

        if (photoId) {
          setPhotoQueue((prev) =>
            prev.map((p) =>
              p.id === photoId
                ? {
                    ...p,
                    methodUsed: recommendedConfig.methodUsed,
                    needsReview: recommendedConfig.needsReview,
                  }
                : p
            )
          );
        }

        if (recommendedConfig.methodUsed === 'A') {
          setStatusMessage({
            type: 'success',
            text: `Thành công [Cách A - Chính]: Tìm thấy khuôn mặt → Lần theo phông nền quanh đầu lấy mép trên & 2 mép bên → Nắn thẳng (${recommendedConfig.rotationDeg}°) → Cắt 3:4 từ mép trên (354×472 px @ 300 DPI).`,
          });
        } else if (recommendedConfig.methodUsed === 'B') {
          setStatusMessage({
            type: 'info',
            text: `Thành công [Cách B - Khối màu trên bàn]: Tìm tấm ảnh như khối khác màu mặt bàn → Nắn thẳng (${recommendedConfig.rotationDeg}°) → Cắt 3:4 (354×472 px @ 300 DPI).`,
          });
        } else {
          setStatusMessage({
            type: 'warning',
            text: `Đánh dấu [XEM - Cách C]: Cắt khung 3:4 quanh khuôn mặt, không nắn thẳng. Vui lòng kiểm tra lại khung cắt hoặc kéo 4 góc xanh nếu cần.`,
          });
        }
      } finally {
        setIsDetecting(false);
      }
    },
    []
  );

  // Load image whenever activePhotoItem changes
  useEffect(() => {
    if (!activePhotoItem) {
      setLoadedImage(null);
      setDetectedFaces([]);
      setDetectedCardRect(null);
      setCroppedDataUrl('');
      return;
    }

    let cancelled = false;
    loadImageFromFile(activePhotoItem.file)
      .then((img) => {
        if (cancelled) return;
        setLoadedImage(img);
        if (activePhotoItem.matchedEmployeeId && !initialTargetEmployee) {
          setTargetEmployeeId(activePhotoItem.matchedEmployeeId);
        }
        void runFaceDetectionOnImage(img, currentAspectRatio, activePhotoItem.id);
      })
      .catch(() => {
        if (!cancelled) {
          setStatusMessage({
            type: 'warning',
            text: 'Không thể đọc định dạng file ảnh này.',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activePhotoItem?.id, initialTargetEmployee, runFaceDetectionOnImage]);

  // Re-render live cropped preview at exact 354 x 472 px (3x4 cm @ 300 DPI) + mild sharpening
  useEffect(() => {
    if (!loadedImage) {
      setCroppedDataUrl('');
      return;
    }
    const url = renderCroppedIdPhotoToDataUrl(
      loadedImage,
      cropConfig,
      OUTPUT_3X4_WIDTH_PX
    );
    setCroppedDataUrl(url);
  }, [loadedImage, cropConfig]);

  // Update aspect ratio while preserving center & zoom
  const handleSelectAspectMode = (mode: '3x4' | '25x35') => {
    const newRatio = mode === '3x4' ? 3 / 4 : 25 / 35;
    setAspectMode(mode);
    setCropConfig((prev) => ({
      ...prev,
      aspectRatio: newRatio,
    }));
  };

  // Switch between multiple detected faces in a photo
  const handleSelectDetectedFace = (faceIndex: number) => {
    if (!loadedImage || !detectedFaces[faceIndex]) return;
    setSelectedFaceIndex(faceIndex);
    const face = detectedFaces[faceIndex];
    const nextConfig = computeIdCropConfigFromFace(
      loadedImage.naturalWidth,
      loadedImage.naturalHeight,
      face,
      currentAspectRatio,
      true
    );
    setCropConfig(nextConfig);
  };

  // Manually trigger Method A, Method B, or Method C
  const handleForceMethod = (method: AutoCropMethod) => {
    if (!loadedImage) return;
    const face = detectedFaces[selectedFaceIndex] || null;

    if (method === 'A' && detectedCardRect) {
      const adjustedH =
        Math.abs(currentAspectRatio - 3 / 4) < 0.01
          ? detectedCardRect.height
          : detectedCardRect.width / currentAspectRatio;
      setCropConfig((prev) => ({
        ...prev,
        centerX: detectedCardRect.x + detectedCardRect.width / 2,
        centerY: detectedCardRect.y + adjustedH / 2,
        baseCropHeight: Math.max(20, adjustedH),
        scale: 1,
        rotationDeg: detectedCardRect.angleDeg || 0,
        methodUsed: 'A',
        needsReview: false,
      }));
      return;
    }

    if (method === 'B') {
      const blockB = tryMethodB_TableColorBlockDeskew(loadedImage);
      if (blockB) {
        setCropConfig((prev) => ({
          ...prev,
          centerX: blockB.centerX,
          centerY: blockB.centerY,
          baseCropHeight: blockB.height,
          scale: 1,
          rotationDeg: blockB.angleDeg,
          methodUsed: 'B',
          needsReview: false,
        }));
        return;
      }
    }

    // Method C: Crop 3:4 around face without rotation (marked "XEM")
    const cfgC = computeIdCropConfigFromFace(
      loadedImage.naturalWidth,
      loadedImage.naturalHeight,
      face,
      currentAspectRatio,
      false
    );
    setCropConfig({
      ...cfgC,
      rotationDeg: 0,
      methodUsed: 'C',
      needsReview: true,
    });
  };

  // Handle adding files via File Input, Drag & Drop, or Clipboard Paste
  const handleAddFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files).filter((f) =>
        f.type.startsWith('image/')
      );
      if (fileArray.length === 0) return;

      const newItems: QueuedPhotoItem[] = fileArray.map((file) => {
        const matchedEmp = findMatchingEmployeeByFileName(file.name);
        return {
          id: `photo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          file,
          fileName: file.name,
          objectUrl: URL.createObjectURL(file),
          matchedEmployeeId: matchedEmp?.id,
        };
      });

      setPhotoQueue((prev) => [...prev, ...newItems]);
      setActivePhotoId(newItems[0].id);
    },
    [findMatchingEmployeeByFileName]
  );

  // Support Ctrl + V paste image anywhere on this view
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const pastedFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const f = items[i].getAsFile();
          if (f) pastedFiles.push(f);
        }
      }
      if (pastedFiles.length > 0) {
        handleAddFiles(pastedFiles);
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handleAddFiles]);

  // Start dragging on viewport (either Move Crop Box, Resize Corner, or Draw New Crop Box)
  const handleViewportPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    dragMode: 'pan' | 'resize' | 'auto' = 'auto'
  ) => {
    if (!loadedImage || !viewportRef.current) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    const rect = viewportRef.current.getBoundingClientRect();
    const clickXImg =
      ((e.clientX - rect.left) / Math.max(1, rect.width)) *
      loadedImage.naturalWidth;
    const clickYImg =
      ((e.clientY - rect.top) / Math.max(1, rect.height)) *
      loadedImage.naturalHeight;

    const effectiveH =
      cropConfig.baseCropHeight / Math.max(0.1, cropConfig.scale);

    if (dragMode === 'resize') {
      setActiveDragType('resize');
    } else if (interactionMode === 'draw') {
      setActiveDragType('draw_box');
    } else {
      setActiveDragType('pan');
    }

    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      startCenterX: cropConfig.centerX,
      startCenterY: cropConfig.centerY,
      startEffectiveHeight: effectiveH,
      drawStartXImg: clickXImg,
      drawStartYImg: clickYImg,
    };
  };

  const handleViewportPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (
      activeDragType === 'none' ||
      !dragStartRef.current ||
      !loadedImage ||
      !viewportRef.current
    ) {
      return;
    }
    const rect = viewportRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const imgScaleX = loadedImage.naturalWidth / rect.width;
    const imgScaleY = loadedImage.naturalHeight / rect.height;

    const dxImg = (e.clientX - dragStartRef.current.clientX) * imgScaleX;
    const dyImg = (e.clientY - dragStartRef.current.clientY) * imgScaleY;

    if (activeDragType === 'pan') {
      setCropConfig((prev) => ({
        ...prev,
        centerX: Math.max(
          0,
          Math.min(
            loadedImage.naturalWidth,
            dragStartRef.current!.startCenterX + dxImg
          )
        ),
        centerY: Math.max(
          0,
          Math.min(
            loadedImage.naturalHeight,
            dragStartRef.current!.startCenterY + dyImg
          )
        ),
      }));
    } else if (activeDragType === 'resize') {
      const curXImg =
        ((e.clientX - rect.left) / rect.width) * loadedImage.naturalWidth;
      const curYImg =
        ((e.clientY - rect.top) / rect.height) * loadedImage.naturalHeight;
      const halfH = Math.max(
        15,
        Math.abs(curYImg - dragStartRef.current.startCenterY),
        Math.abs(curXImg - dragStartRef.current.startCenterX) /
          cropConfig.aspectRatio
      );
      const newEffectiveHeight = Math.min(loadedImage.naturalHeight, halfH * 2);
      setCropConfig((prev) => ({
        ...prev,
        baseCropHeight: newEffectiveHeight,
        scale: 1,
      }));
    } else if (activeDragType === 'draw_box') {
      const curXImg = Math.max(
        0,
        Math.min(
          loadedImage.naturalWidth,
          ((e.clientX - rect.left) / rect.width) * loadedImage.naturalWidth
        )
      );
      const curYImg = Math.max(
        0,
        Math.min(
          loadedImage.naturalHeight,
          ((e.clientY - rect.top) / rect.height) * loadedImage.naturalHeight
        )
      );
      const x1 = Math.min(dragStartRef.current.drawStartXImg, curXImg);
      const x2 = Math.max(dragStartRef.current.drawStartXImg, curXImg);
      const y1 = Math.min(dragStartRef.current.drawStartYImg, curYImg);
      const y2 = Math.max(dragStartRef.current.drawStartYImg, curYImg);
      const boxW = Math.max(20, x2 - x1);
      const boxH = Math.max(25, y2 - y1);
      const fittedH = Math.max(boxH, boxW / cropConfig.aspectRatio);

      setCropConfig((prev) => ({
        ...prev,
        centerX: (x1 + x2) / 2,
        centerY: (y1 + y2) / 2,
        baseCropHeight: fittedH,
        scale: 1,
      }));
    }
  };

  const handleViewportPointerUp = () => {
    if (activeDragType === 'draw_box') {
      setInteractionMode('move');
    }
    setActiveDragType('none');
    dragStartRef.current = null;
  };

  // Save cropped 3x4 photo (354 x 472 px @ 300 DPI) to the selected Employee
  const handleSaveToSelectedEmployee = async (printImmediately = false) => {
    if (!loadedImage || !targetEmployee) return;
    setIsSavingToEmp(true);
    try {
      const finalDataUrl = renderCroppedIdPhotoToDataUrl(
        loadedImage,
        cropConfig,
        OUTPUT_3X4_WIDTH_PX
      );
      await onUpdateEmployeePhoto(targetEmployee, finalDataUrl);
      setStatusMessage({
        type: 'success',
        text: `Đã lưu ảnh thẻ 3×4 (354×472 px @ 300 DPI) cho nhân viên ${targetEmployee.fullName} (MSNV: ${targetEmployee.msnv})!`,
      });

      if (printImmediately && onOpenPrintDialog) {
        onOpenPrintDialog([targetEmployee.id]);
      } else if (onCloseModal) {
        setTimeout(() => {
          onCloseModal();
        }, 600);
      }
    } finally {
      setIsSavingToEmp(false);
    }
  };

  // Download exact 354 x 472 px (3x4 cm @ 300 DPI) JPEG to computer
  const handleDownloadCroppedImage = () => {
    if (!loadedImage) return;
    const highResDataUrl = renderCroppedIdPhotoToDataUrl(
      loadedImage,
      cropConfig,
      OUTPUT_3X4_WIDTH_PX
    );
    const link = document.createElement('a');
    const methodTag = cropConfig.needsReview ? '_XEM' : '';
    const empPrefix = targetEmployee
      ? `${targetEmployee.msnv}_${targetEmployee.fullName.replace(/\s+/g, '_')}_`
      : '';
    link.download = `Anh_3x4_300DPI_${empPrefix}354x472${methodTag}.jpg`;
    link.href = highResDataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Batch AI Face Crop & Auto-Match to Employees by Filename
  const handleBatchAutoCropToEmployees = async () => {
    if (photoQueue.length === 0) return;
    setIsBatchProcessing(true);
    let updatedCount = 0;
    let reviewCount = 0;

    try {
      for (const item of photoQueue) {
        const matchedEmp =
          employees.find((e) => e.id === item.matchedEmployeeId) ||
          findMatchingEmployeeByFileName(item.fileName);

        const img = await loadImageFromFile(item.file);
        const { recommendedConfig } = await detectFacesInImage(img);
        if (recommendedConfig.needsReview) reviewCount++;

        setPhotoQueue((prev) =>
          prev.map((p) =>
            p.id === item.id
              ? {
                  ...p,
                  methodUsed: recommendedConfig.methodUsed,
                  needsReview: recommendedConfig.needsReview,
                }
              : p
          )
        );

        if (matchedEmp) {
          const dataUrl = renderCroppedIdPhotoToDataUrl(
            img,
            { ...recommendedConfig, aspectRatio: currentAspectRatio },
            OUTPUT_3X4_WIDTH_PX
          );
          await onUpdateEmployeePhoto(matchedEmp, dataUrl);
          updatedCount++;
        }
      }

      if (updatedCount > 0) {
        setStatusMessage({
          type: reviewCount > 0 ? 'warning' : 'success',
          text: `Đã chạy quy trình A→B→C (354×472 px @ 300 DPI) và gán cho ${updatedCount}/${photoQueue.length} nhân viên.${
            reviewCount > 0
              ? ` Có ${reviewCount} ảnh dùng Cách C được đánh dấu "XEM" cần kiểm tra lại.`
              : ''
          }`,
        });
      } else {
        setStatusMessage({
          type: 'info',
          text: `Đã chạy phân tích A→B→C cho ${photoQueue.length} ảnh (${reviewCount} ảnh đánh dấu "XEM"). Hãy chọn nhân viên ở cột phải để lưu.`,
        });
      }
    } finally {
      setIsBatchProcessing(false);
    }
  };

  // Direct Upload without opening preview: takes filename as MSNV and adds straight to the matching employee(s)
  const handleDirectUploadByMsnvNoPreview = async (
    fileList: FileList | File[]
  ) => {
    const files = Array.from(fileList).filter((f) =>
      f.type.startsWith('image/')
    );
    if (files.length === 0) return;

    setDirectMsnvProgress({ current: 0, total: files.length });
    const matchedLabels: string[] = [];
    const unmatchedFiles: string[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setDirectMsnvProgress({ current: i + 1, total: files.length });
        const matchedEmp = findMatchingEmployeeByFileName(file.name);

        if (!matchedEmp) {
          unmatchedFiles.push(file.name);
          continue;
        }

        try {
          const img = await loadImageFromFile(file);
          const { recommendedConfig } = await detectFacesInImage(img);
          const dataUrl = renderCroppedIdPhotoToDataUrl(
            img,
            { ...recommendedConfig, aspectRatio: currentAspectRatio },
            OUTPUT_3X4_WIDTH_PX
          );
          await onUpdateEmployeePhoto(matchedEmp, dataUrl);
          matchedLabels.push(`${matchedEmp.msnv} (${matchedEmp.fullName})`);
        } catch {
          unmatchedFiles.push(file.name);
        }
      }

      if (matchedLabels.length > 0) {
        const previewList = matchedLabels.slice(0, 5).join(', ');
        const moreText =
          matchedLabels.length > 5
            ? ` và ${matchedLabels.length - 5} NV khác`
            : '';
        const unmatchedNote =
          unmatchedFiles.length > 0
            ? ` · Không khớp MSNV (${unmatchedFiles.length} file: ${unmatchedFiles.slice(0, 3).join(', ')})`
            : '';
        setStatusMessage({
          type: unmatchedFiles.length > 0 ? 'warning' : 'success',
          text: `Đã thêm thẳng ${matchedLabels.length}/${files.length} ảnh 3×4 theo MSNV (không cần preview): ${previewList}${moreText}${unmatchedNote}!`,
        });
      } else {
        setStatusMessage({
          type: 'warning',
          text: `Không tìm thấy nhân viên có MSNV trùng tên ảnh (${unmatchedFiles.slice(0, 4).join(', ')}). Vui lòng đặt tên file ảnh theo đúng MSNV (VD: 90993.jpg, 91051.png).`,
        });
      }
    } finally {
      setDirectMsnvProgress(null);
    }
  };

  // Compute crop box rectangle in percentage of the original image for the interactive overlay
  const cropBoxOverlayPct = useMemo(() => {
    if (!loadedImage) return null;
    const imgW = loadedImage.naturalWidth || 1;
    const imgH = loadedImage.naturalHeight || 1;
    const cropH = cropConfig.baseCropHeight / Math.max(0.08, cropConfig.scale);
    const cropW = cropH * cropConfig.aspectRatio;
    const leftPct = ((cropConfig.centerX - cropW / 2) / imgW) * 100;
    const topPct = ((cropConfig.centerY - cropH / 2) / imgH) * 100;
    const widthPct = (cropW / imgW) * 100;
    const heightPct = (cropH / imgH) * 100;
    return { leftPct, topPct, widthPct, heightPct };
  }, [loadedImage, cropConfig]);

  const previewEmployeeForCard: Employee = useMemo(() => {
    if (targetEmployee) {
      return {
        ...targetEmployee,
        photoUrl: croppedDataUrl || targetEmployee.photoUrl,
      };
    }
    return {
      id: 'preview_ai_crop',
      msnv: '90993',
      fullName: 'TRƯƠNG MINH HIẾU',
      department: 'Bảo trì vận hành',
      joinDate: '02/10/2026',
      photoUrl: croppedDataUrl,
      printCount: 0,
      lastPrintedAt: '',
      ownerId: 'vietsun_workspace',
    };
  }, [targetEmployee, croppedDataUrl]);

  return (
    <div className="space-y-5">
      {/* Top Header Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-700 text-white flex items-center justify-center shrink-0 shadow-xs">
            <ScanFace className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-slate-900">
                Công Cụ Cắt Lấy Ảnh Thẻ 3×4 Tự Động (Quy Trình 3 Bước A → B → C)
              </h2>
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200 rounded font-mono-num">
                3×4 cm @ 300 DPI (354 × 472 px) + Tăng Nét Nhẹ
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Dùng cho cả <strong className="text-slate-700">ảnh thẻ đặt trên bàn</strong> lẫn <strong className="text-slate-700">ảnh thẻ dán trên hồ sơ (có chữ, dấu đỏ xung quanh)</strong>:
              <span className="ml-1 text-slate-600">
                (A) Tìm mặt &amp; lần phông nền lấy mép trên + 2 mép bên → (B) Tách khối màu trên bàn → (C) Cắt 3:4 quanh mặt [XEM].
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* DIRECT UPLOAD BY MSNV WITHOUT PREVIEW */}
          <label
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer shadow-xs transition-colors"
            title="Chọn 1 hoặc nhiều ảnh có tên file là MSNV (VD: 90993.jpg) để cắt 3×4 và gán thẳng vào nhân viên mà không cần mở bảng preview"
          >
            <UserCheck className="w-4 h-4" />
            {directMsnvProgress
              ? `Đang thêm ${directMsnvProgress.current}/${directMsnvProgress.total} ảnh...`
              : 'Thêm Thẳng Theo MSNV (Không Preview)'}
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={Boolean(directMsnvProgress)}
              onChange={(e) => {
                if (e.target.files) {
                  void handleDirectUploadByMsnvNoPreview(e.target.files);
                }
                e.target.value = '';
              }}
              className="hidden"
            />
          </label>

          <label className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer shadow-xs transition-colors">
            <Upload className="w-4 h-4" />
            Chọn Ảnh (Có Preview &amp; Chỉnh Khung)
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                if (e.target.files) handleAddFiles(e.target.files);
                e.target.value = '';
              }}
              className="hidden"
            />
          </label>

          {photoQueue.length >= 1 && (
            <button
              type="button"
              disabled={isBatchProcessing}
              onClick={handleBatchAutoCropToEmployees}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg cursor-pointer disabled:opacity-50 transition-colors"
              title="Tự động chạy quy trình A→B→C và gán theo MSNV cho tất cả ảnh đang mở"
            >
              <Wand2 className="w-4 h-4" />
              {isBatchProcessing
                ? 'Đang xử lý A→B→C...'
                : `Gán Hàng Loạt (${photoQueue.length} ảnh)`}
            </button>
          )}

          {onCloseModal && (
            <button
              type="button"
              onClick={onCloseModal}
              className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
            >
              <X className="w-4 h-4" />
              Đóng
            </button>
          )}
        </div>
      </div>

      {/* Status Alert Banner */}
      {statusMessage && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-3 ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : statusMessage.type === 'warning'
                ? 'bg-amber-50 border-amber-300 text-amber-950'
                : 'bg-blue-50 border-blue-200 text-blue-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : statusMessage.type === 'warning' ? (
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            ) : (
              <Sparkles className="w-4 h-4 text-blue-600 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="p-1 rounded hover:bg-black/5 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Multi-Photo Queue Strip */}
      {photoQueue.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-2.5 overflow-x-auto">
          <span className="text-xs font-bold text-slate-600 shrink-0 px-2">
            Ảnh đang mở ({photoQueue.length}):
          </span>
          {photoQueue.map((item) => {
            const isActive = item.id === activePhotoId;
            const matchedEmp = employees.find(
              (e) => e.id === item.matchedEmployeeId
            );
            return (
              <div
                key={item.id}
                onClick={() => setActivePhotoId(item.id)}
                className={`group relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer shrink-0 transition-all ${
                  isActive
                    ? 'border-blue-600 bg-blue-50/70 text-blue-900 font-bold shadow-2xs'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                }`}
              >
                <img
                  src={item.objectUrl}
                  alt={item.fileName}
                  className="w-7 h-9 object-cover rounded border border-slate-300 bg-white"
                />
                <div className="max-w-[150px]">
                  <div className="flex items-center gap-1">
                    <span className="truncate text-[11px]">{item.fileName}</span>
                    {item.needsReview ? (
                      <span className="px-1 py-0.2 bg-amber-500 text-slate-950 font-mono-num font-bold text-[9px] rounded shrink-0">
                        XEM
                      </span>
                    ) : item.methodUsed ? (
                      <span className="px-1 py-0.2 bg-emerald-600 text-white font-mono-num font-bold text-[9px] rounded shrink-0">
                        Cách {item.methodUsed}
                      </span>
                    ) : null}
                  </div>
                  {matchedEmp && (
                    <div className="text-[10px] text-emerald-700 font-mono-num truncate">
                      Khớp: {matchedEmp.msnv}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPhotoQueue((prev) => {
                      const next = prev.filter((p) => p.id !== item.id);
                      if (activePhotoId === item.id) {
                        setActivePhotoId(next[0]?.id || '');
                      }
                      return next;
                    });
                  }}
                  className="p-0.5 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                  title="Xóa ảnh khỏi danh sách"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Main 12-Col Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Columns: Source Photo + Interactive Overlay */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                1. Ảnh Gốc &amp; Khung Dò Tìm Ảnh Thẻ 3×4
              </span>
              {loadedImage && (
                <span className="text-[11px] font-mono-num text-slate-500">
                  ({loadedImage.naturalWidth} × {loadedImage.naturalHeight} px)
                </span>
              )}
            </div>

            {loadedImage && (
              <div className="flex flex-wrap items-center gap-2">
                {detectedFaces.length > 1 && (
                  <div className="flex items-center gap-1 bg-amber-50 border border-amber-300 px-2 py-1 rounded-lg text-[11px] font-bold text-amber-900">
                    <Users className="w-3.5 h-3.5 text-amber-600" />
                    <span>Chọn mặt ({detectedFaces.length}):</span>
                    {detectedFaces.map((f, idx) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => handleSelectDetectedFace(idx)}
                        className={`px-1.5 py-0.5 rounded font-mono-num cursor-pointer ${
                          selectedFaceIndex === idx
                            ? 'bg-amber-600 text-white'
                            : 'bg-white text-amber-900 hover:bg-amber-100'
                        }`}
                      >
                        #{idx + 1}
                      </button>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() =>
                    setInteractionMode((m) => (m === 'draw' ? 'move' : 'draw'))
                  }
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg border cursor-pointer transition-colors ${
                    interactionMode === 'draw'
                      ? 'bg-amber-500 text-slate-950 border-amber-600'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                  title="Bấm rồi kéo chuột trực tiếp trên ảnh để khoanh vùng tấm ảnh 3×4 cần cắt"
                >
                  <Crop className="w-3.5 h-3.5" />
                  {interactionMode === 'draw'
                    ? 'Đang bật: Kéo Chuột Khoanh Vùng'
                    : 'Kéo Chuột Khoanh Vùng'}
                </button>

                <button
                  type="button"
                  onClick={() => setShowKeypointsOverlay((v) => !v)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg border cursor-pointer ${
                    showKeypointsOverlay
                      ? 'bg-blue-50 text-blue-700 border-blue-200'
                      : 'bg-white text-slate-600 border-slate-300'
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  Khung AI ({detectedFaces.length} mặt)
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void runFaceDetectionOnImage(
                      loadedImage,
                      currentAspectRatio,
                      activePhotoItem?.id
                    )
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg cursor-pointer"
                  title="Chạy lại quy trình A -> B -> C"
                >
                  <ScanFace className="w-3.5 h-3.5" />
                  Chạy Lại A→B→C
                </button>
              </div>
            )}
          </div>

          {/* Interactive Image Canvas Area */}
          {!loadedImage ? (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files) {
                  handleAddFiles(e.dataTransfer.files);
                }
              }}
              className="p-12 min-h-[420px] flex flex-col items-center justify-center text-center bg-slate-50/60"
            >
              <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-200 text-blue-700 flex items-center justify-center mb-4">
                <ScanFace className="w-8 h-8" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">
                Kéo thả ảnh vào đây, bấm Chọn Ảnh hoặc nhấn Ctrl + V
              </h3>
              <p className="text-xs text-slate-500 max-w-lg mt-1.5 leading-relaxed">
                Hệ thống tự động thử lần lượt: <strong className="text-slate-700">Cách A</strong> (Tìm mặt → lần phông nền quanh đầu lấy mép trên &amp; 2 mép bên → nắn thẳng → cắt 3:4 từ mép trên) → <strong className="text-slate-700">Cách B</strong> (Tách khối ảnh trên mặt bàn → nắn thẳng) → <strong className="text-slate-700">Cách C</strong> (Cắt 3:4 quanh mặt, đánh dấu &quot;XEM&quot;).
              </p>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <label
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl cursor-pointer shadow-xs transition-colors"
                  title="Lấy tên file ảnh là MSNV (VD: 90993.jpg) thêm thẳng vào nhân viên tương ứng, không cần mở bảng preview"
                >
                  <UserCheck className="w-4 h-4" />
                  {directMsnvProgress
                    ? `Đang thêm ${directMsnvProgress.current}/${directMsnvProgress.total} ảnh...`
                    : 'Thêm Thẳng Theo MSNV (Không Cần Preview)'}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={Boolean(directMsnvProgress)}
                    onChange={(e) => {
                      if (e.target.files) {
                        void handleDirectUploadByMsnvNoPreview(e.target.files);
                      }
                      e.target.value = '';
                    }}
                    className="hidden"
                  />
                </label>

                <label className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded-xl cursor-pointer shadow-xs transition-colors">
                  <Upload className="w-4 h-4" />
                  Tải Ảnh Lên Để Xem Trước &amp; Cắt 3×4
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                      if (e.target.files) handleAddFiles(e.target.files);
                      e.target.value = '';
                    }}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-slate-900 flex flex-col items-center justify-center min-h-[440px] relative select-none overflow-hidden">
              {isDetecting && (
                <div className="absolute inset-0 z-30 bg-slate-900/75 flex flex-col items-center justify-center text-white gap-2">
                  <ScanFace className="w-9 h-9 text-blue-400 animate-pulse" />
                  <span className="text-xs font-bold tracking-wide">
                    Đang chạy quy trình A → B → C (dò mặt &amp; lần phông nền quanh đầu)...
                  </span>
                </div>
              )}

              {/* Image Wrapper with Overlays */}
              <div
                ref={viewportRef}
                onPointerDown={(e) => handleViewportPointerDown(e, 'auto')}
                onPointerMove={handleViewportPointerMove}
                onPointerUp={handleViewportPointerUp}
                onPointerCancel={handleViewportPointerUp}
                onWheel={(e) => {
                  e.preventDefault();
                  const factor = e.deltaY < 0 ? 1.08 : 0.92;
                  setCropConfig((prev) => ({
                    ...prev,
                    scale: Math.max(
                      0.15,
                      Math.min(10.0, Number((prev.scale * factor).toFixed(2)))
                    ),
                  }));
                }}
                className={`relative inline-block max-w-full max-h-[500px] touch-none ${
                  interactionMode === 'draw' ? 'cursor-crosshair' : 'cursor-move'
                }`}
                title="Kéo khung trắng để di chuyển, kéo 4 góc xanh để phóng to/thu nhỏ khung cắt, hoặc lăn chuột"
              >
                <img
                  src={activePhotoItem?.objectUrl}
                  alt="Source"
                  draggable={false}
                  className="max-w-full max-h-[500px] w-auto h-auto block select-none pointer-events-none"
                />

                {/* AI Detected Face Bounding Boxes & Keypoints */}
                {showKeypointsOverlay &&
                  detectedFaces.map((face, idx) => {
                    const imgW = loadedImage.naturalWidth || 1;
                    const imgH = loadedImage.naturalHeight || 1;
                    const isSelected = idx === selectedFaceIndex;
                    return (
                      <React.Fragment key={face.id}>
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectDetectedFace(idx);
                          }}
                          style={{
                            left: `${(face.x / imgW) * 100}%`,
                            top: `${(face.y / imgH) * 100}%`,
                            width: `${(face.width / imgW) * 100}%`,
                            height: `${(face.height / imgH) * 100}%`,
                          }}
                          className={`absolute z-20 border border-dashed rounded transition-all cursor-pointer ${
                            isSelected
                              ? 'border-emerald-400 bg-emerald-400/10'
                              : 'border-amber-400/80 bg-amber-400/10 hover:border-amber-300'
                          }`}
                          title={`Khuôn mặt #${idx + 1}`}
                        >
                          <span
                            className={`absolute -top-4 left-0 px-1 py-0.2 text-[8px] font-mono-num font-bold rounded whitespace-nowrap shadow-xs ${
                              isSelected
                                ? 'bg-emerald-500 text-white'
                                : 'bg-amber-500 text-slate-950'
                            }`}
                          >
                            Mặt #{idx + 1}
                          </span>
                        </div>

                        {isSelected &&
                          face.keypoints.map((kp, kIdx) => (
                            <div
                              key={kIdx}
                              style={{
                                left: `${(kp.x / imgW) * 100}%`,
                                top: `${(kp.y / imgH) * 100}%`,
                              }}
                              className="absolute z-20 w-1.5 h-1.5 -ml-0.5 -mt-0.5 rounded-full bg-cyan-300 border border-slate-900 pointer-events-none"
                            />
                          ))}
                      </React.Fragment>
                    );
                  })}

                {/* Active 3x4 Crop Frame Overlay with Interactive Corner Resize Handles */}
                {cropBoxOverlayPct && (
                  <div
                    style={{
                      left: `${cropBoxOverlayPct.leftPct}%`,
                      top: `${cropBoxOverlayPct.topPct}%`,
                      width: `${cropBoxOverlayPct.widthPct}%`,
                      height: `${cropBoxOverlayPct.heightPct}%`,
                      transform: cropConfig.rotationDeg
                        ? `rotate(${-cropConfig.rotationDeg}deg)`
                        : undefined,
                      boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.62)',
                    }}
                    className={`absolute z-20 border-2 pointer-events-none ${
                      cropConfig.needsReview
                        ? 'border-amber-400'
                        : 'border-white'
                    }`}
                  >
                    {/* 4 Interactive Corner Resize Handles */}
                    <div
                      onPointerDown={(e) => handleViewportPointerDown(e, 'resize')}
                      className="pointer-events-auto absolute -top-2 -left-2 w-4 h-4 rounded-xs bg-blue-500 border-2 border-white cursor-nwse-resize shadow-xs"
                      title="Kéo góc để thay đổi kích thước khung cắt"
                    />
                    <div
                      onPointerDown={(e) => handleViewportPointerDown(e, 'resize')}
                      className="pointer-events-auto absolute -top-2 -right-2 w-4 h-4 rounded-xs bg-blue-500 border-2 border-white cursor-nesw-resize shadow-xs"
                      title="Kéo góc để thay đổi kích thước khung cắt"
                    />
                    <div
                      onPointerDown={(e) => handleViewportPointerDown(e, 'resize')}
                      className="pointer-events-auto absolute -bottom-2 -left-2 w-4 h-4 rounded-xs bg-blue-500 border-2 border-white cursor-nesw-resize shadow-xs"
                      title="Kéo góc để thay đổi kích thước khung cắt"
                    />
                    <div
                      onPointerDown={(e) => handleViewportPointerDown(e, 'resize')}
                      className="pointer-events-auto absolute -bottom-2 -right-2 w-4 h-4 rounded-xs bg-blue-500 border-2 border-white cursor-nwse-resize shadow-xs"
                      title="Kéo góc để thay đổi kích thước khung cắt"
                    />

                    {/* ID Card Portrait Guide Lines */}
                    {showBiometricGuides && (
                      <>
                        <div
                          style={{ top: '12%' }}
                          className="absolute inset-x-1 border-t border-dashed border-cyan-300/80"
                        />
                        <div
                          style={{ top: '42%' }}
                          className="absolute inset-x-0 border-t border-dashed border-amber-300/85"
                        />
                        <div
                          style={{ top: '72%' }}
                          className="absolute inset-x-1 border-t border-dashed border-cyan-300/80"
                        />
                        <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-white/50" />
                      </>
                    )}

                    <div
                      className={`absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] font-mono-num font-bold px-2 py-0.5 rounded whitespace-nowrap shadow-xs ${
                        cropConfig.needsReview
                          ? 'bg-amber-500 text-slate-950'
                          : 'bg-blue-700 text-white'
                      }`}
                    >
                      {cropConfig.needsReview
                        ? 'Cách C [XEM] · 3:4'
                        : `Cách ${cropConfig.methodUsed || 'A'} · 3:4`}
                    </div>
                  </div>
                )}
              </div>

              {/* Quick Pipeline Stage Switcher Bar under Canvas */}
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs">
                <span className="text-slate-300 text-[11px] flex items-center gap-1 mr-1">
                  <Move className="w-3.5 h-3.5 text-blue-400" />
                  Chế độ cắt:
                </span>
                <button
                  type="button"
                  onClick={() => handleForceMethod('A')}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-lg cursor-pointer transition-colors ${
                    cropConfig.methodUsed === 'A'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700'
                  }`}
                  title="Tìm khuôn mặt -> lần theo phông nền quanh đầu lấy mép trên & 2 mép bên -> nắn thẳng -> cắt 3:4 từ mép trên"
                >
                  A. Lần Phông Quanh Đầu (Chính)
                </button>
                <button
                  type="button"
                  onClick={() => handleForceMethod('B')}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-lg cursor-pointer transition-colors ${
                    cropConfig.methodUsed === 'B'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700'
                  }`}
                  title="Tìm tấm ảnh như một khối khác màu mặt bàn -> nắn thẳng"
                >
                  B. Khối Màu Khác Mặt Bàn (Nghiêng)
                </button>
                <button
                  type="button"
                  onClick={() => handleForceMethod('C')}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-lg cursor-pointer transition-colors ${
                    cropConfig.methodUsed === 'C'
                      ? 'bg-amber-500 text-slate-950 shadow-xs'
                      : 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700'
                  }`}
                  title="Cắt khung 3:4 quanh khuôn mặt, không nắn (đánh dấu XEM)"
                >
                  C. Cắt 3:4 Quanh Mặt (XEM)
                </button>
              </div>
            </div>
          )}

          {/* Fine-Tuning Sliders Panel */}
          {loadedImage && (
            <div className="p-4 bg-slate-50 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              {/* Ratio & Zoom */}
              <div className="space-y-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1.5">
                    Chuẩn kích thước xuất ra
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleSelectAspectMode('3x4')}
                      className={`py-1.5 px-2.5 rounded-lg font-bold border text-center cursor-pointer transition-colors ${
                        aspectMode === '3x4'
                          ? 'bg-blue-700 text-white border-blue-700'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      3×4 cm @ 300 DPI (354×472)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectAspectMode('25x35')}
                      className={`py-1.5 px-2.5 rounded-lg font-bold border text-center cursor-pointer transition-colors ${
                        aspectMode === '25x35'
                          ? 'bg-blue-700 text-white border-blue-700'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      Khung 25×35mm (5:7)
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-slate-700 flex items-center gap-1">
                      <ZoomIn className="w-3.5 h-3.5 text-blue-600" />
                      Thu phóng (Zoom Khung Cắt)
                    </span>
                    <span className="font-mono-num font-bold text-blue-700">
                      {Math.round(cropConfig.scale * 100)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setCropConfig((p) => ({
                          ...p,
                          scale: Math.max(
                            0.2,
                            Number((p.scale * 0.88).toFixed(2))
                          ),
                        }))
                      }
                      className="p-1 bg-white border border-slate-300 rounded hover:bg-slate-100 cursor-pointer"
                    >
                      <ZoomOut className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="range"
                      min={0.25}
                      max={6.0}
                      step={0.02}
                      value={cropConfig.scale}
                      onChange={(e) =>
                        setCropConfig((p) => ({
                          ...p,
                          scale: Number(e.target.value),
                        }))
                      }
                      className="flex-1 accent-blue-700"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setCropConfig((p) => ({
                          ...p,
                          scale: Math.min(
                            6.0,
                            Number((p.scale * 1.12).toFixed(2))
                          ),
                        }))
                      }
                      className="p-1 bg-white border border-slate-300 rounded hover:bg-slate-100 cursor-pointer"
                    >
                      <ZoomIn className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Rotation (Deskew), Brightness, Contrast, Mild Sharpening */}
              <div className="space-y-2.5">
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-semibold text-slate-700">
                      Góc nắn thẳng ({cropConfig.rotationDeg}°)
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setCropConfig((p) => ({ ...p, rotationDeg: 0 }))
                      }
                      className="text-[11px] text-blue-700 hover:underline cursor-pointer"
                    >
                      Về 0°
                    </button>
                  </div>
                  <input
                    type="range"
                    min={-30}
                    max={30}
                    step={0.5}
                    value={cropConfig.rotationDeg}
                    onChange={(e) =>
                      setCropConfig((p) => ({
                        ...p,
                        rotationDeg: Number(e.target.value),
                      }))
                    }
                    className="w-full accent-blue-700"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-semibold text-slate-700 flex items-center gap-1">
                        <Sun className="w-3 h-3 text-amber-500" />
                        Độ sáng
                      </span>
                      <span className="font-mono-num text-[11px]">
                        {cropConfig.brightness}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={75}
                      max={135}
                      step={1}
                      value={cropConfig.brightness}
                      onChange={(e) =>
                        setCropConfig((p) => ({
                          ...p,
                          brightness: Number(e.target.value),
                        }))
                      }
                      className="w-full accent-blue-700"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-semibold text-slate-700 flex items-center gap-1">
                        <Contrast className="w-3 h-3 text-blue-600" />
                        Tương phản
                      </span>
                      <span className="font-mono-num text-[11px]">
                        {cropConfig.contrast}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={80}
                      max={135}
                      step={1}
                      value={cropConfig.contrast}
                      onChange={(e) =>
                        setCropConfig((p) => ({
                          ...p,
                          contrast: Number(e.target.value),
                        }))
                      }
                      className="w-full accent-blue-700"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      setCropConfig((p) => ({ ...p, sharpen: !p.sharpen }))
                    }
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border font-semibold cursor-pointer ${
                      cropConfig.sharpen
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Tăng nét nhẹ
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setCropConfig((p) => ({ ...p, flipH: !p.flipH }))
                    }
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border font-semibold cursor-pointer ${
                      cropConfig.flipH
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    <FlipHorizontal className="w-3.5 h-3.5" />
                    Lật ngang
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void runFaceDetectionOnImage(
                        loadedImage,
                        currentAspectRatio,
                        activePhotoItem?.id
                      )
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-slate-600 hover:text-slate-900 bg-white border border-slate-300 rounded-lg cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Đặt lại
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right 5 Columns: Live 3x4 Result (354x472 px) + ID Card Preview + Assign to Employee / Download */}
        <div className="lg:col-span-5 space-y-5">
          {/* Card 1: Cropped 3x4 Result + Assign to Employee */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                2. Ảnh Thẻ Sau Khi Cắt &amp; Nắn Thẳng (354 × 472 px)
              </span>
              {loadedImage && (
                <span
                  className={`text-[10px] font-mono-num font-bold px-2 py-0.5 rounded border ${
                    cropConfig.needsReview
                      ? 'text-amber-950 bg-amber-400 border-amber-500'
                      : 'text-emerald-700 bg-emerald-50 border-emerald-200'
                  }`}
                >
                  {cropConfig.needsReview
                    ? 'XEM (Cách C - Chưa nắn)'
                    : `Cách ${cropConfig.methodUsed || 'A'} · Đã nắn thẳng`}
                </span>
              )}
            </div>

            <div className="p-5 space-y-5">
              {/* Side-by-side: Cropped Portrait + Specs */}
              <div className="flex flex-col sm:flex-row items-center gap-5 bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div
                  style={{
                    width: '118px',
                    height: '157px',
                  }}
                  className="relative bg-white border-2 border-slate-800 shadow-sm overflow-hidden shrink-0 flex items-center justify-center"
                >
                  {croppedDataUrl ? (
                    <>
                      <img
                        src={croppedDataUrl}
                        alt="Cropped 3x4 354x472"
                        className="w-full h-full object-cover"
                      />
                      {cropConfig.needsReview && (
                        <span className="absolute top-1 right-1 px-1.5 py-0.5 text-[9px] font-mono-num font-bold bg-amber-400 text-slate-950 rounded shadow-xs">
                          XEM
                        </span>
                      )}
                    </>
                  ) : (
                    <div className="text-center p-2 text-slate-400 text-xs">
                      <ImageIcon className="w-6 h-6 mx-auto mb-1 opacity-50" />
                      Chưa có ảnh
                    </div>
                  )}
                </div>

                <div className="flex-1 space-y-2 text-xs">
                  <div className="font-bold text-slate-900">
                    Thông số ảnh xuất chuẩn 300 DPI:
                  </div>
                  <ul className="space-y-1 text-slate-600 text-[11px]">
                    <li className="flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      Độ phân giải:{' '}
                      <strong className="font-mono-num text-slate-900">
                        {OUTPUT_3X4_WIDTH_PX} × {OUTPUT_3X4_HEIGHT_PX} px (3×4 cm @ 300 DPI)
                      </strong>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      Phương pháp:{' '}
                      <strong className="text-slate-900">
                        {cropConfig.methodUsed === 'A'
                          ? 'Cách A (Lần phông nền quanh đầu)'
                          : cropConfig.methodUsed === 'B'
                            ? 'Cách B (Tách khối màu trên bàn)'
                            : 'Cách C (Khung 3:4 quanh mặt [XEM])'}
                      </strong>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      Xử lý hậu kỳ:{' '}
                      <strong className="text-slate-900">
                        {cropConfig.sharpen ? 'Đã tăng nét nhẹ (Unsharp Mask)' : 'Gốc'}
                      </strong>
                    </li>
                  </ul>

                  <div className="pt-1">
                    <button
                      type="button"
                      disabled={!croppedDataUrl}
                      onClick={handleDownloadCroppedImage}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg disabled:opacity-50 cursor-pointer transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Tải Ảnh 3×4 (354×472 px @ 300 DPI)
                    </button>
                  </div>
                </div>
              </div>

              {/* Assign directly to an Employee in the system */}
              <div className="space-y-3 pt-2 border-t border-slate-200 text-xs">
                <div className="font-bold text-slate-800 flex items-center gap-1.5">
                  <UserCheck className="w-4 h-4 text-blue-700" />
                  Gán Ảnh Này Vào Hồ Sơ &amp; Thẻ Nhân Viên:
                </div>

                {!initialTargetEmployee && (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={empSearchQuery}
                      onChange={(e) => setEmpSearchQuery(e.target.value)}
                      placeholder="Tìm nhanh nhân viên theo MSNV hoặc Họ tên..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:border-blue-600"
                    />
                  </div>
                )}

                <select
                  value={targetEmployeeId}
                  onChange={(e) => setTargetEmployeeId(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                >
                  {filteredEmployees.length === 0 ? (
                    <option value="">-- Không tìm thấy nhân viên --</option>
                  ) : (
                    filteredEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.msnv} — {emp.fullName} ({emp.department})
                        {emp.photoUrl ? ' [Đã có ảnh]' : ' [Chưa có ảnh]'}
                      </option>
                    ))
                  )}
                </select>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <button
                    type="button"
                    disabled={!croppedDataUrl || !targetEmployee || isSavingToEmp}
                    onClick={() => handleSaveToSelectedEmployee(false)}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50 cursor-pointer shadow-xs transition-colors"
                  >
                    <UserCheck className="w-4 h-4" />
                    {isSavingToEmp
                      ? 'Đang lưu...'
                      : 'Lưu Ảnh Vào Thẻ Nhân Viên'}
                  </button>

                  {onOpenPrintDialog && (
                    <button
                      type="button"
                      disabled={!croppedDataUrl || !targetEmployee || isSavingToEmp}
                      onClick={() => handleSaveToSelectedEmployee(true)}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded-lg disabled:opacity-50 cursor-pointer shadow-xs transition-colors"
                    >
                      <Printer className="w-4 h-4" />
                      Lưu &amp; In Thẻ Ngay (Ctrl+P)
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Live Preview inside VIETSUN ĐỒNG NAI ID Card */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                3. Xem Trước Trực Tiếp Trên Thẻ Nhân Viên VIETSUN
              </span>
              <span className="text-[11px] font-mono-num text-slate-500">
                {previewEmployeeForCard.msnv} · {previewEmployeeForCard.fullName}
              </span>
            </div>

            <div className="p-5 bg-slate-100 flex flex-col items-center justify-center overflow-x-auto">
              <div
                style={{
                  width:
                    selectedTemplate.orientation === 'portrait'
                      ? '58mm'
                      : '92mm',
                  height:
                    selectedTemplate.orientation === 'portrait'
                      ? '92mm'
                      : '52mm',
                }}
                className="bg-white shadow-sm"
              >
                <IdCardPreview
                  employee={previewEmployeeForCard}
                  template={selectedTemplate}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface FaceCropModalProps {
  isOpen: boolean;
  onClose: () => void;
  employees: Employee[];
  selectedTemplate: CardTemplate;
  targetEmployee: Employee | null;
  onUpdateEmployeePhoto: (emp: Employee, photoUrl: string) => Promise<void>;
  onOpenPrintDialog?: (employeeIds?: string[]) => void;
}

export const FaceCropModal: React.FC<FaceCropModalProps> = ({
  isOpen,
  onClose,
  employees,
  selectedTemplate,
  targetEmployee,
  onUpdateEmployeePhoto,
  onOpenPrintDialog,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/65 p-3 sm:p-5 overflow-y-auto">
      <div className="bg-slate-100 border border-slate-200 rounded-2xl w-full max-w-[1280px] max-h-[94vh] overflow-y-auto p-4 sm:p-6 shadow-2xl">
        <FaceCropStudioView
          employees={employees}
          selectedTemplate={selectedTemplate}
          onUpdateEmployeePhoto={onUpdateEmployeePhoto}
          onOpenPrintDialog={onOpenPrintDialog}
          initialTargetEmployee={targetEmployee}
          onCloseModal={onClose}
        />
      </div>
    </div>
  );
};
