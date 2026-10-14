import type { MeaningVisual as MeaningVisualDto } from "@learning/contracts";

export function MeaningVisualView({ visual, mediaUrl }: { visual: MeaningVisualDto; mediaUrl: (id: string) => string }) {
  switch (visual.kind) {
    case "image":
      return <img className="kid-illustration" src={mediaUrl(visual.imageAssetId)} alt="" data-testid="kid-illustration" />;
    case "color":
      return <svg className="kid-visual" viewBox="0 0 96 96" role="img" aria-label="Kolor"><rect x="8" y="8" width="80" height="80" rx="12" fill={visual.color} /></svg>;
    case "number":
      return <svg className="kid-visual kid-visual-number" viewBox="0 0 160 100" role="img" aria-label={`${visual.count} elementów`}>{Array.from({ length: visual.count }, (_, index) => <circle key={index} cx={12 + (index % 10) * 15} cy={12 + Math.floor(index / 10) * 18} r="5.5" fill="#5367b8" />)}</svg>;
  }
}
