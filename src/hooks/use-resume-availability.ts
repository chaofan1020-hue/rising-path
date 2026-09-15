'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { RESUME_UPDATED_EVENT, RESUME_UPDATED_STORAGE_KEY } from '@/lib/dashboard-cache';
import {
  classifyResumeAvailability,
  type ResumeAvailability,
  type ResumeAvailabilityItem,
} from '@/lib/resume-availability';

export function useResumeAvailability<T extends ResumeAvailabilityItem = ResumeAvailabilityItem>() {
  const [resumes, setResumes] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const fetchingRef = useRef(false);

  const reload = useCallback(async (showLoading = false) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    if (showLoading) setLoading(true);
    try {
      const response = await apiFetch('/api/resume');
      const data = await response.json() as { resumes?: T[]; error?: string };
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'resume-load-failed');
      setResumes(Array.isArray(data.resumes) ? data.resumes : []);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'resume-load-failed');
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload(true);
  }, [reload]);

  const availability = useMemo(() => classifyResumeAvailability(resumes), [resumes]);

  useEffect(() => {
    if (availability.status !== 'processing') return;
    const interval = window.setInterval(() => {
      void reload(false);
    }, 2500);
    return () => window.clearInterval(interval);
  }, [availability.status, reload]);

  useEffect(() => {
    const refresh = () => void reload(false);
    const onStorage = (event: StorageEvent) => {
      if (event.key === RESUME_UPDATED_STORAGE_KEY) refresh();
    };
    window.addEventListener(RESUME_UPDATED_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener(RESUME_UPDATED_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', refresh);
    };
  }, [reload]);

  return {
    resumes,
    loading,
    error,
    availability,
    reload,
  };
}

export type UseResumeAvailabilityResult<T extends ResumeAvailabilityItem = ResumeAvailabilityItem> = {
  resumes: T[];
  loading: boolean;
  error: string;
  availability: ResumeAvailability<T>;
  reload: (showLoading?: boolean) => Promise<void>;
};
