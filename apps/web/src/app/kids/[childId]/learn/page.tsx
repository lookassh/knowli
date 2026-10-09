import { KidLearningHost } from "@/kid/KidLearningHost";

export default async function ChildLearnPage({ params }: { params: Promise<{ childId: string }> }) {
  const { childId } = await params;
  return <KidLearningHost initialChildId={childId} />;
}
