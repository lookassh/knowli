import type { ReactElement } from "react";
import { Paper, Table, Text, Title, VisuallyHidden } from "@mantine/core";
import { messages, REPORT_SKILLS, type ItemSkillStatus, type ProgressItemDto } from "@learning/contracts";

/** Kolor kropki i odznaki statusu (zmienne `--pp-bar-*` w progress-panel.css). */
export const STATUS_TONE: Record<ItemSkillStatus, "mastered" | "needs" | "practicing" | "none"> = {
  mastered: "mastered",
  needs_confirmation: "needs",
  needs_reconfirmation: "needs",
  practicing: "practicing",
  not_assessed: "none",
};

/** Legenda kropek: cztery stany opanowania. */
export function StatusLegend({ testId }: { testId?: string }) {
  const entries = [
    ["mastered", messages.progress.legendMastered],
    ["needs", messages.progress.legendNeeds],
    ["practicing", messages.progress.legendPracticing],
    ["none", messages.progress.legendNotAssessed],
  ] as const;
  return (
    <div className="pp-prog-legend" data-testid={testId}>
      {entries.map(([tone, label]) => (
        <span key={tone}><i className="pp-prog-dot" data-tone={tone} aria-hidden="true" />{label}</span>
      ))}
    </div>
  );
}

function statusDot(status: ItemSkillStatus): ReactElement {
  return (
    <span className="pp-prog-dotcell">
      <i className="pp-prog-dot" data-tone={STATUS_TONE[status]} aria-hidden="true" />
      <VisuallyHidden>{messages.progress.itemStatus[status]}</VisuallyHidden>
    </span>
  );
}

/**
 * Lista słów w dwóch układach tego samego raportu: tabela od 901 px, karty
 * poniżej. Ukryty układ (display: none) nie trafia do drzewa dostępności.
 */
export default function ProgressItems({ items }: { items: ProgressItemDto[] }) {
  return (
    <Paper component="section" withBorder radius="lg" p="md" className="pp-prog-items" aria-labelledby="progress-items-heading">
      <Title order={3} fz="md" id="progress-items-heading" mb="xs">{messages.progress.allWords}</Title>
      <StatusLegend testId="progress-legend" />
      {items.length === 0 ? <Text mt="sm">{messages.progress.wordsEmpty}</Text> : (
        <>
          <Table.ScrollContainer minWidth={720} className="pp-prog-table" mt="sm">
            <Table verticalSpacing="xs" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th scope="col">{messages.progress.targetWord}</Table.Th>
                  <Table.Th scope="col">{messages.progress.sourceWord}</Table.Th>
                  {REPORT_SKILLS.map((skill) => (
                    <Table.Th scope="col" key={skill}>{messages.progress.skills[skill]}</Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((item) => (
                  <Table.Tr key={item.itemId}>
                    <Table.Th scope="row">
                      <span lang="en-GB" className="pp-prog-word">{item.target}</span>
                      {item.meaningChanged && <Text component="small" size="xs" display="block" className="pp-prog-muted">{messages.progress.materialChanged}</Text>}
                    </Table.Th>
                    <Table.Td>{item.source}</Table.Td>
                    {REPORT_SKILLS.map((skill) => (
                      <Table.Td key={skill}>{statusDot(item.skills[skill])}</Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          <ul className="pp-prog-cards">
            {items.map((item) => (
              <li className="pp-prog-wordcard" key={item.itemId}>
                <h4><span lang="en-GB">{item.target}</span> — {item.source}</h4>
                {item.meaningChanged && <Text size="xs" className="pp-prog-muted">{messages.progress.materialChanged}</Text>}
                <dl>
                  {REPORT_SKILLS.map((skill) => (
                    <div key={skill}>
                      <dt>{messages.progress.skills[skill]}</dt>
                      <dd>
                        <span className="pp-prog-status" data-tone={STATUS_TONE[item.skills[skill]]}>
                          {messages.progress.itemStatus[item.skills[skill]]}
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </Paper>
  );
}
