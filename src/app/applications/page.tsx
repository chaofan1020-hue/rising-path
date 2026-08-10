import { redirect } from 'next/navigation';

export default function ApplicationsPage() {
  redirect('/field-mappings?tab=applications');
}
