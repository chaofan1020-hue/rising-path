import { redirect } from 'next/navigation';

export default function PersonalityPage() {
  redirect('/resume?quiz=1');
}
