import { apiFetch } from './api-client';

export async function getPostLoginDestination(): Promise<string> {
  try {
    const response = await apiFetch('/api/resume', { cache: 'no-store' });
    if (!response.ok) return '/home';
    const json = (await response.json()) as {
      resumes?: Array<{
        processing_status?: string;
        segmentation_confirmed?: boolean;
      }>;
    };
    const resumes = Array.isArray(json.resumes) ? json.resumes : [];
    const latest = resumes[0];
    if (!latest) return '/resume?first=1';
    if (latest.processing_status !== 'ready' || latest.segmentation_confirmed !== true) {
      return '/resume';
    }
    return '/dashboard';
  } catch {
    return '/home';
  }
}
