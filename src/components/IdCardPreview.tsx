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

  // Layout 1: VIETSUN ĐỒNG NAI (Authentic Table-Frame Design without red stamp)
  if (template.layoutStyle === 'vietsun_table') {
    const borderCol = template.borderColor || '#292524';
    const photoWidthPct = Math.min(42, Math.max(22, template.photoWidthPercent || 28));

    return (
      <div
        className={`relative select-none ${showCropMarks ? 'outline outline-1 outline-dashed outline-slate-300' : ''} ${className}`}
        style={containerStyle}
      >
        <div className="w-full h-full p-[2.6mm] box-border">
          {/* Outer double-line table frame */}
          <div
            className="w-full h-full border-[1.8px] p-[0.5mm] box-border"
            style={{ borderColor: borderCol }}
          >
            <div
              className="w-full h-full border-[1px] flex flex-col relative box-border"
              style={{ borderColor: borderCol }}
            >
              {/* Top Header Row (approx 29% height) */}
              <div
                className="h-[29%] w-full border-b-[1.4px] flex items-center px-2 box-border"
                style={{ borderColor: borderCol }}
              >
                {/* Top-Left Logo Block */}
                <div
                  className="shrink-0 flex items-center justify-start pr-1.5"
                  style={{ width: `${photoWidthPct + 2}%` }}
                >
                  <img
                    src={template.logoUrl || OFFICIAL_VIETSUN_LOGO}
                    alt="VIETSUN Logo"
                    referrerPolicy="no-referrer"
                    className="max-h-[11.5mm] w-full object-contain object-left"
                  />
                </div>

                {/* Top-Right Company Title Block */}
                <div className="flex-1 flex flex-col items-center justify-center text-center leading-[1.18] pl-1">
                  <div
                    className="font-bold uppercase tracking-wide"
                    style={{ fontSize: `${template.headerFontSize || 8.5}px` }}
                  >
                    {template.companyBranch || 'VIETSUN ĐỒNG NAI'}
                  </div>
                  <div
                    className="font-bold uppercase"
                    style={{ fontSize: `${(template.headerFontSize || 8.5) - 0.3}px` }}
                  >
                    {template.companyNameLine1 || 'CHI NHÁNH CÔNG TY CỔ PHẦN'}
                  </div>
                  <div
                    className="font-bold uppercase"
                    style={{ fontSize: `${(template.headerFontSize || 8.5) - 0.3}px` }}
                  >
                    {template.companyNameLine2 || 'ĐẦU TƯ MẶT TRỜI VIỆT'}
                  </div>
                  <div
                    className="font-bold tracking-[0.25em] leading-none mt-[1px]"
                    style={{ fontSize: '7px' }}
                  >
                    * * * * * *
                  </div>
                </div>
              </div>

              {/* Bottom Body Section (71% height) */}
              <div className="flex-1 w-full flex overflow-hidden">
                {/* Left Column: 3x4 Portrait Photo */}
                <div
                  className="h-full border-r-[1.4px] shrink-0 relative overflow-hidden"
                  style={{
                    width: `${photoWidthPct}%`,
                    borderColor: borderCol,
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

                {/* Right Column: 4 Horizontal Divided Rows */}
                <div className="flex-1 h-full flex flex-col">
                  {/* Row 1: Full Name */}
                  <div
                    className="flex-1 border-b-[1.3px] flex items-center justify-center px-1.5 text-center overflow-hidden"
                    style={{ borderColor: borderCol }}
                  >
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
                  <div
                    className="flex-1 border-b-[1.3px] flex items-center justify-center px-1.5 text-center overflow-hidden"
                    style={{ borderColor: borderCol }}
                  >
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
                  <div
                    className="flex-1 border-b-[1.3px] flex items-center justify-center px-1.5 text-center overflow-hidden"
                    style={{ borderColor: borderCol }}
                  >
                    <span
                      className="font-bold leading-tight truncate"
                      style={{
                        fontSize: `${template.deptFontSize || 12.5}px`,
                        transform: `translateY(${template.deptOffsetY || 0}px)`,
                      }}
                    >
                      {template.deptPrefix ?? 'BP. '}
                      {employee.department}
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
                backgroundColor: template.photoBgColor || '#1d4ed8',
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
                  bgColor={template.photoBgColor || '#1d4ed8'}
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
              backgroundColor: template.photoBgColor || '#2563eb',
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
                bgColor={template.photoBgColor || '#2563eb'}
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
