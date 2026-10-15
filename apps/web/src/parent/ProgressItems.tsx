import type { ReactElement } from "react";
import { messages, REPORT_SKILLS, type ItemSkillStatus, type ProgressItemDto } from "@learning/contracts";

/** Klasa kropek statusu; tekst statusu czytelnik ekranu dostaje obok kropki. */
const STATUS_DOT: Record<ItemSkillStatus, string> = {
  mastered: "pp-dot-m",
  needs_confirmation: "pp-dot-n",
  needs_reconfirmation: "pp-dot-n",
  practicing: "pp-dot-p",
  not_assessed: "pp-dot-x",
};

function statusDot(status: ItemSkillStatus): ReactElement {
  return (
    <span className="pp-dotcell">
      <i className={`pp-dot ${STATUS_DOT[status]}`} aria-hidden="true" />
      <span className="pp-sr-only">{messages.progress.itemStatus[status]}</span>
    </span>
  );
}

/** Dwa układy tego samego raportu; ukryty układ nie trafia do drzewa dostępności. */
export default function ProgressItems({ items }: { items: ProgressItemDto[] }) {
  return (
    <section className="progress-items pp-card" aria-labelledby="progress-items-heading">
      <h3 className="pp-card-title" id="progress-items-heading">
        {messages.progress.allWords}
      </h3>
      <div className="pp-legend">
        <span><i className="pp-dot pp-dot-m" />{messages.progress.legendMastered}</span>
        <span><i className="pp-dot pp-dot-n" />{messages.progress.legendNeeds}</span>
        <span><i className="pp-dot pp-dot-p" />{messages.progress.legendPracticing}</span>
        <span><i className="pp-dot pp-dot-x" />{messages.progress.legendNotAssessed}</span>
      </div>
      {items.length === 0 ? <p>{messages.progress.wordsEmpty}</p> : (
        <>
          <div className="pp-tablewrap">
            <table className="pp-words">
              <thead>
                <tr>
                  <th scope="col">{messages.progress.targetWord}</th>
                  <th scope="col">{messages.progress.sourceWord}</th>
                  {REPORT_SKILLS.map((skill) => (
                    <th scope="col" key={skill}>{messages.progress.skills[skill]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.itemId}>
                    <th scope="row">
                      <span lang="en-GB" className="pp-en">{item.target}</span>
                      {item.meaningChanged && <small className="pp-mini">{messages.progress.materialChanged}</small>}
                    </th>
                    <td>{item.source}</td>
                    {REPORT_SKILLS.map((skill) => (
                      <td key={skill}>{statusDot(item.skills[skill])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="plain progress-items-cards">
            {items.map((item) => (
              <li className="pp-card" key={item.itemId}>
                <h4><span lang="en-GB">{item.target}</span> — {item.source}</h4>
                {item.meaningChanged && <p className="pp-mini">{messages.progress.materialChanged}</p>}
                <dl>
                  {REPORT_SKILLS.map((skill) => (
                    <div key={skill}>
                      <dt>{messages.progress.skills[skill]}</dt>
                      <dd>
                        <span className={`progress-status progress-status-${item.skills[skill]}`}>
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
    </section>
  );
}
