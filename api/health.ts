interface VercelReq {
  method?: string;
}

interface VercelRes {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => VercelRes;
  json: (body: unknown) => void;
  end: () => void;
}

export default function handler(req: VercelReq, res: VercelRes) {
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

  res.status(200).json({
    success: true,
    service: 'VIETSUN ĐỒNG NAI - Employee Integration API (Vercel Serverless)',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
}
