import React from 'react';
import { CardTemplate, Employee, OFFICIAL_VIETSUN_LOGO } from '../types';

interface IdCardPreviewProps {
  employee: Employee;
  template: CardTemplate;
  side?: 'front' | 'back';
  scale?: number;
  cardWidthMm?: number;
  cardHeightMm?: number;
  showCropMarks?: boolean;
  className?: string;
}

const DefaultPortraitAvatar: React.FC<{ bgColor: string; fullName?: string }> = ({
  bgColor,
}) => {
  return (
    <div
      className="w-full h-full relative overflow-hidden select-none"
      style={{ backgroundColor: bgColor || '#ffffff' }}
    />
  );
};

export const IdCardPreview: React.FC<IdCardPreviewProps> = ({
  employee,
  template,
  scale = 1,
  cardWidthMm = 85.6,
  cardHeightMm = 54,
  showCropMarks = false,
  className = '',
}) => {
  const isPortrait = template.orientation === 'portrait';
  const widthMm = isPortrait
    ? Math.min(cardWidthMm, cardHeightMm)
    : Math.max(cardWidthMm, cardHeightMm);
  const heightMm = isPortrait
    ? Math.max(cardWidthMm, cardHeightMm)
    : Math.min(cardWidthMm, cardHeightMm);

  const containerStyle: React.CSSProperties = {
    width: `${widthMm}mm`,
    height: `${heightMm}mm`,
    transform: scale !== 1 ? `scale(${scale})` : undefined,
    transformOrigin: 'top left',
    backgroundColor: template.backgroundColor || '#ffffff',
    color: template.textColor || '#1c1917',
    fontFamily: template.fontFamily || "'Noto Serif', 'Times New Roman', serif",
    position: 'relative',
    overflow: 'hidden',
    boxSizing: 'border-box',
    WebkitPrintColorAdjust: 'exact',
    printColorAdjust: 'exact',
  };

  // Layout 1: VIETSUN ĐỒNG NAI (Authentic Table-Frame Design with Vector SVG Grid Lines so lines never drop in window.print)
  if (template.layoutStyle === 'vietsun_table') {
    const borderCol = template.borderColor || '#1c1917';
    const rawPhotoPct = template.photoWidthPercent || 22.5;
    // Normalize legacy 28%-30% default down to 22.5% to match the 25mm x 35mm photo ratio
    const normalizedPhotoPct =
      rawPhotoPct >= 27.5 && rawPhotoPct <= 30 ? 22.5 : rawPhotoPct;
    const photoWidthPct = Math.min(38, Math.max(18, normalizedPhotoPct));

    // SVG coordinate system (804 x 488 matches the inner padded area)
    const innerLeft = 8;
    const innerTop = 8;
    const innerRight = 796;
    const innerBottom = 480;
    const innerW = innerRight - innerLeft; // 788
    const innerH = innerBottom - innerTop; // 472

    // Taller header (37%) so the photo cell below is shorter and fits 25mm x 35mm proportion
    const headerRatio = 0.37;
    const yHeaderLine = Math.round(innerTop + innerH * headerRatio); // 183
    const xPhotoLine = Math.round(innerLeft + innerW * (photoWidthPct / 100)); // ~185

    const bodyH = innerBottom - yHeaderLine; // 297
    const yRow1 = Math.round(yHeaderLine + bodyH * 0.25);
    const yRow2 = Math.round(yHeaderLine + bodyH * 0.5);
    const yRow3 = Math.round(yHeaderLine + bodyH * 0.75);

    return (
      <div
        className={`relative select-none ${showCropMarks ? 'outline outline-1 outline-dashed outline-slate-300' : ''} ${className}`}
        style={containerStyle}
      >
        <div className="w-full h-full p-[2.6mm] box-border relative">
          <div className="w-full h-full relative">
            {/* Content Layer (Aligned to the exact inner table coordinates) */}
            <div
              className="absolute flex flex-col box-border overflow-hidden"
              style={{
                left: `${(innerLeft / 804) * 100}%`,
                top: `${(innerTop / 488) * 100}%`,
                width: `${(innerW / 804) * 100}%`,
                height: `${(innerH / 488) * 100}%`,
              }}
            >
              {/* Top Header Row (37% height — taller header so photo below is shorter) */}
              <div
                className="w-full flex items-center px-2.5 box-border shrink-0"
                style={{ height: `${headerRatio * 100}%` }}
              >
                {/* Top-Left Logo Block */}
                <div
                  className="shrink-0 flex items-center justify-start pr-1.5"
                  style={{ width: `${Math.min(34, photoWidthPct + 6.5)}%` }}
                >
                  <img
                    src={template.logoUrl || OFFICIAL_VIETSUN_LOGO}
                    alt="VIETSUN Logo"
                    referrerPolicy="no-referrer"
                    className="max-h-[12.5mm] w-full object-contain object-left"
                  />
                </div>

                {/* Top-Right Company Title Block */}
                <div className="flex-1 flex flex-col items-center justify-center text-center leading-[1.26] pl-1">
                  <div
                    className="font-bold uppercase tracking-wide"
                    style={{ fontSize: `${(template.headerFontSize || 8.5) + 0.5}px` }}
                  >
                    {template.companyBranch || 'VIETSUN ĐỒNG NAI'}
                  </div>
                  <div
                    className="font-bold uppercase"
                    style={{ fontSize: `${(template.headerFontSize || 8.5) + 0.2}px` }}
                  >
                    {template.companyNameLine1 || 'CHI NHÁNH CÔNG TY CỔ PHẦN'}
                  </div>
                  <div
                    className="font-bold uppercase"
                    style={{ fontSize: `${(template.headerFontSize || 8.5) + 0.2}px` }}
                  >
                    {template.companyNameLine2 || 'ĐẦU TƯ MẶT TRỜI VIỆT'}
                  </div>
                  <div
                    className="font-bold tracking-[0.25em] leading-none mt-[2px]"
                    style={{ fontSize: '7.5px' }}
                  >
                    * * * * * *
                  </div>
                </div>
              </div>

              {/* Bottom Body Section (63% height — shorter photo cell matching 25mm x 35mm ratio) */}
              <div className="flex-1 w-full flex overflow-hidden">
                {/* Left Column: 25mm x 35mm Portrait Photo */}
                <div
                  className="h-full shrink-0 relative overflow-hidden"
                  style={{
                    width: `${photoWidthPct}%`,
                    backgroundColor: template.photoBgColor || '#ffffff',
                  }}
                >
                  {employee.photoUrl ? (
                    <img
                      src={employee.photoUrl}
                      alt={employee.fullName}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover object-top"
                    />
                  ) : (
                    <DefaultPortraitAvatar
                      bgColor={template.photoBgColor || '#ffffff'}
                      fullName={employee.fullName}
                    />
                  )}
                </div>

                {/* Right Column: 4 Horizontal Divided Rows */}
                <div className="flex-1 h-full flex flex-col">
                  {/* Row 1: Full Name */}
                  <div className="flex-1 flex items-center justify-center px-1.5 text-center overflow-hidden">
                    <span
                      className="font-bold uppercase tracking-tight leading-tight truncate"
                      style={{
                        fontSize: `${template.nameFontSize || 13.5}px`,
                        transform: `translateY(${template.nameOffsetY || 0}px)`,
                      }}
                    >
                      {employee.fullName}
                    </span>
                  </div>

                  {/* Row 2: MSNV */}
                  <div className="flex-1 flex items-center justify-center px-1.5 text-center overflow-hidden">
                    <span
                      className="font-bold tracking-wide leading-none"
                      style={{
                        fontSize: `${template.msnvFontSize || 14}px`,
                        transform: `translateY(${template.msnvOffsetY || 0}px)`,
                      }}
                    >
                      {employee.msnv}
                    </span>
                  </div>

                  {/* Row 3: Department */}
                  <div className="flex-1 flex items-center justify-center px-1.5 text-center overflow-hidden">
                    <span
                      className="font-bold leading-tight truncate"
                      style={{
                        fontSize: `${template.deptFontSize || 12.5}px`,
                        transform: `translateY(${template.deptOffsetY || 0}px)`,
                      }}
                    >
                      {(() => {
                        const dept = (employee.department || '')
                          .trim()
                          .replace(/^(?:bp\.?\s*){2,}/i, 'BP. ');
                        const rawPfx = (template.deptPrefix ?? '').trim();
                        const pfx = /^bp\.?$/i.test(rawPfx) ? '' : template.deptPrefix ?? '';
                        if (
                          !pfx.trim() ||
                          /^bp\.?\s+/i.test(dept) ||
                          dept.toLowerCase().startsWith(pfx.trim().toLowerCase())
                        ) {
                          return dept;
                        }
                        return `${pfx}${dept}`;
                      })()}
                    </span>
                  </div>

                  {/* Row 4: Join Date */}
                  <div className="flex-1 flex items-center justify-center px-1.5 text-center overflow-hidden">
                    <span
                      className="font-bold leading-none"
                      style={{
                        fontSize: `${template.dateFontSize || 12}px`,
                        transform: `translateY(${template.dateOffsetY || 0}px)`,
                      }}
                    >
                      {employee.joinDate}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Vector SVG Table Frame & Grid Lines Overlay (z-20 so lines are never clipped or hidden in window.print) */}
            <svg
              viewBox="0 0 804 488"
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full pointer-events-none z-20"
              shapeRendering="geometricPrecision"
            >
              {/* Outer Thick Frame */}
              <rect
                x="1.5"
                y="1.5"
                width="801"
                height="485"
                fill="none"
                stroke={borderCol}
                strokeWidth="3.2"
              />
              {/* Inner Thin Frame */}
              <rect
                x={innerLeft}
                y={innerTop}
                width={innerW}
                height={innerH}
                fill="none"
                stroke={borderCol}
                strokeWidth="2.2"
              />
              {/* Full-Width Horizontal Line Below Header (Under Logo & Company Name) */}
              <line
                x1={innerLeft}
                y1={yHeaderLine}
                x2={innerRight}
                y2={yHeaderLine}
                stroke={borderCol}
                strokeWidth="2.4"
              />
              {/* Vertical Line Separating 3x4 Photo Frame and 4 Info Rows */}
              <line
                x1={xPhotoLine}
                y1={yHeaderLine}
                x2={xPhotoLine}
                y2={innerBottom}
                stroke={borderCol}
                strokeWidth="2.4"
              />
              {/* Horizontal Divider 1 (Below Full Name) */}
              <line
                x1={xPhotoLine}
                y1={yRow1}
                x2={innerRight}
                y2={yRow1}
                stroke={borderCol}
                strokeWidth="2.2"
              />
              {/* Horizontal Divider 2 (Below MSNV) */}
              <line
                x1={xPhotoLine}
                y1={yRow2}
                x2={innerRight}
                y2={yRow2}
                stroke={borderCol}
                strokeWidth="2.2"
              />
              {/* Horizontal Divider 3 (Below Department) */}
              <line
                x1={xPhotoLine}
                y1={yRow3}
                x2={innerRight}
                y2={yRow3}
                stroke={borderCol}
                strokeWidth="2.2"
              />
            </svg>
          </div>
        </div>
      </div>
    );
  }

  // Layout 2: Minimal Vertical Portrait Card
  if (template.layoutStyle === 'minimal_vertical' || isPortrait) {
    return (
      <div
        className={`relative select-none ${showCropMarks ? 'outline outline-1 outline-dashed outline-slate-300' : ''} ${className}`}
        style={containerStyle}
      >
        <div
          className="w-full h-full border flex flex-col justify-between box-border overflow-hidden"
          style={{ borderColor: template.borderColor || '#cbd5e1' }}
        >
          {/* Top Brand Header */}
          <div
            className="w-full py-2.5 px-3 text-white text-center"
            style={{ backgroundColor: template.primaryColor || '#1e40af' }}
          >
            <div className="font-bold text-[10px] uppercase tracking-wider">
              {template.companyBranch || 'VIETSUN ĐỒNG NAI'}
            </div>
            <div className="text-[7.5px] opacity-90 uppercase mt-0.5">
              {template.companyNameLine1 || 'CÔNG TY CP ĐẦU TƯ MẶT TRỜI VIỆT'}
            </div>
          </div>

          {/* Center Portrait Photo */}
          <div className="flex flex-col items-center px-3 pt-2">
            <div
              className="w-[24mm] h-[31mm] border-2 rounded overflow-hidden shadow-xs"
              style={{
                borderColor: template.primaryColor || '#1e40af',
                backgroundColor: template.photoBgColor || '#ffffff',
              }}
            >
              {employee.photoUrl ? (
                <img
                  src={employee.photoUrl}
                  alt={employee.fullName}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                <DefaultPortraitAvatar
                  bgColor={template.photoBgColor || '#ffffff'}
                  fullName={employee.fullName}
                />
              )}
            </div>
          </div>

          {/* Employee Details */}
          <div className="px-3 pb-2.5 pt-1.5 text-center flex-1 flex flex-col justify-between">
            <div>
              <div
                className="font-bold uppercase leading-tight"
                style={{
                  fontSize: `${template.nameFontSize || 12.5}px`,
                  color: template.textColor || '#0f172a',
                  transform: `translateY(${template.nameOffsetY || 0}px)`,
                }}
              >
                {employee.fullName}
              </div>
              <div
                className="font-semibold mt-0.5"
                style={{
                  fontSize: `${template.deptFontSize || 10.5}px`,
                  color: template.primaryColor || '#1e40af',
                  transform: `translateY(${template.deptOffsetY || 0}px)`,
                }}
              >
                {template.deptPrefix}
                {employee.department}
              </div>
            </div>

            <div className="border-t border-slate-200 pt-1.5 flex items-center justify-between text-[9px]">
              <span
                className="font-bold"
                style={{ fontSize: `${template.msnvFontSize || 10.5}px` }}
              >
                MSNV: {employee.msnv}
              </span>
              <span
                className="opacity-80"
                style={{ fontSize: `${template.dateFontSize || 9.5}px` }}
              >
                {employee.joinDate}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Layout 3: Modern Corporate Horizontal Card
  return (
    <div
      className={`relative select-none ${showCropMarks ? 'outline outline-1 outline-dashed outline-slate-300' : ''} ${className}`}
      style={containerStyle}
    >
      <div
        className="w-full h-full border flex flex-col justify-between box-border overflow-hidden"
        style={{ borderColor: template.borderColor || '#cbd5e1' }}
      >
        {/* Top Banner */}
        <div
          className="h-[14mm] px-3 flex items-center justify-between text-white shrink-0"
          style={{ backgroundColor: template.primaryColor || '#1d4ed8' }}
        >
          <div className="flex items-center gap-2">
            <img
              src={template.logoUrl || OFFICIAL_VIETSUN_LOGO}
              alt="Logo"
              referrerPolicy="no-referrer"
              className="h-[9.5mm] w-auto object-contain bg-white px-2 py-0.5 rounded"
            />
          </div>
          <div className="text-right leading-tight">
            <div
              className="font-bold uppercase"
              style={{ fontSize: `${template.headerFontSize || 8.5}px` }}
            >
              {template.companyBranch || 'VIETSUN ĐỒNG NAI'}
            </div>
            <div className="text-[7px] opacity-90 uppercase">
              {template.companyNameLine1} {template.companyNameLine2}
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 p-2.5 flex items-center gap-3 relative">
          <div
            className="h-full rounded border overflow-hidden shrink-0"
            style={{
              width: `${template.photoWidthPercent || 28}%`,
              borderColor: template.primaryColor || '#1d4ed8',
              backgroundColor: template.photoBgColor || '#ffffff',
            }}
          >
            {employee.photoUrl ? (
              <img
                src={employee.photoUrl}
                alt={employee.fullName}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            ) : (
              <DefaultPortraitAvatar
                bgColor={template.photoBgColor || '#ffffff'}
                fullName={employee.fullName}
              />
            )}
          </div>

          <div className="flex-1 flex flex-col justify-center gap-1.5">
            <div>
              <div className="text-[7.5px] uppercase tracking-wider text-slate-400 font-semibold">
                THẺ NHÂN VIÊN / EMPLOYEE ID
              </div>
              <div
                className="font-bold uppercase leading-tight mt-0.5"
                style={{
                  fontSize: `${template.nameFontSize || 13}px`,
                  color: template.textColor || '#0f172a',
                  transform: `translateY(${template.nameOffsetY || 0}px)`,
                }}
              >
                {employee.fullName}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1 border-y border-slate-200 py-1.5">
              <div>
                <div className="text-[7px] text-slate-400 uppercase">Mã số NV</div>
                <div
                  className="font-bold font-mono-num"
                  style={{
                    fontSize: `${template.msnvFontSize || 12}px`,
                    color: template.primaryColor || '#1d4ed8',
                    transform: `translateY(${template.msnvOffsetY || 0}px)`,
                  }}
                >
                  {employee.msnv}
                </div>
              </div>
              <div>
                <div className="text-[7px] text-slate-400 uppercase">Ngày vào làm</div>
                <div
                  className="font-semibold font-mono-num"
                  style={{
                    fontSize: `${template.dateFontSize || 10.5}px`,
                    transform: `translateY(${template.dateOffsetY || 0}px)`,
                  }}
                >
                  {employee.joinDate}
                </div>
              </div>
            </div>

            <div>
              <div
                className="font-semibold truncate"
                style={{
                  fontSize: `${template.deptFontSize || 11}px`,
                  transform: `translateY(${template.deptOffsetY || 0}px)`,
                }}
              >
                {template.deptPrefix}
                {employee.department}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Accent Strip */}
        <div
          className="h-[2mm] w-full"
          style={{ backgroundColor: template.secondaryColor || '#3b82f6' }}
        />
      </div>
    </div>
  );
};
