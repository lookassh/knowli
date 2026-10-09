import { KidLearningHost } from "@/app/learn/KidLearningHost";

export default async function ChildLearnPage({ params }: { params: Promise<{ childId: string }> }) {
  const { childId } = await params;
  return <KidLearningHost initialChildId={childId} />;
}
