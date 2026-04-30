import { redirect } from 'next/navigation';

export default function ClassroomIndexPage({ params }: { params: { id: string } }) {
  redirect(`/teacher/classrooms/${params.id}/students`);
}
