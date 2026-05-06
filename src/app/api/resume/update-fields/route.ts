import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function POST(request: NextRequest) {
  try {
    const { resume_id, parsed_fields } = await request.json();

    if (!resume_id || !parsed_fields) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    // Update parsed_fields in the database
    const { error } = await supabase
      .from('resumes')
      .update({
        parsed_fields: parsed_fields,
        updated_at: new Date().toISOString(),
      })
      .eq('id', resume_id);

    if (error) {
      console.error('Failed to update parsed fields:', error);
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
    }

    // Also update user_info from parsed_fields
    const userInfo: Record<string, unknown> = {};
    if (parsed_fields.name) userInfo.name = parsed_fields.name;
    if (parsed_fields.email) userInfo.email = parsed_fields.email;
    if (parsed_fields.phone) userInfo.phone = parsed_fields.phone;
    if (parsed_fields.education) {
      userInfo.education = parsed_fields.education.map(
        (e: { school: string; degree: string; major: string; duration?: string }) =>
          `${e.school} - ${e.degree} ${e.major}${e.duration ? ` (${e.duration})` : ''}`
      );
    }
    if (parsed_fields.experience) {
      userInfo.experience = parsed_fields.experience.map(
        (e: { company: string; title: string; duration?: string }) =>
          `${e.company} - ${e.title}${e.duration ? ` (${e.duration})` : ''}`
      );
    }
    if (parsed_fields.skills) {
      const allSkills = [
        ...(parsed_fields.skills.technical || []),
        ...(parsed_fields.skills.languages || []),
        ...(parsed_fields.skills.tools || []),
      ];
      if (allSkills.length > 0) userInfo.skills = allSkills;
    }

    const { error: error2 } = await supabase
      .from('resumes')
      .update({ user_info: userInfo })
      .eq('id', resume_id);

    if (error2) {
      console.error('Failed to update user_info:', error2);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update fields error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
