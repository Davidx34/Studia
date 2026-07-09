'use client';
import AIBrainConfig from '@/components/AIBrainConfig';
export default function BrainPage({ params }: { params: { id: string } }) {
  return (
    <div className='p-6'>
      <AIBrainConfig classroomId={params.id} />
    </div>
  );
}