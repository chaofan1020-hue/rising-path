import { redirect } from 'next/navigation';

export default function LegacyJobRotationPage() {
  redirect('/admin/jobs/sync');
}
