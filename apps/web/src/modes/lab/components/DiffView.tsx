// Owner: T3d. Rule-level policy diff (spec §10): added / removed / changed rules, conditions, thresholds,
// actions and params, rendered as readable dispatch rules.
import type { Action, Condition, Policy, Rule } from '@headway/sim';
import type { ConditionChange, PolicyDiff, RuleChange } from '../diff';
import { KIND_LABEL, describeAction, describeCondition, diffSummary, fmtNum, paramLabel, paramValue } from '../diff';

const OPS: Record<Condition['op'], string> = { '<': '<', '<=': '≤', '>': '>', '>=': '≥', '==': '=' };

function Say({ text }: { text: string }) {
  // highlight {placeholders} so templates read as templates
  const parts = text.split(/(\{[a-zA-Z_]+\})/g);
  return (
    <p className="lab-rule__say">
      “{parts.map((p, i) => (/^\{[a-zA-Z_]+\}$/.test(p) ? <span key={i} className="lab-ph">{p.slice(1, -1)}</span> : p))}”
    </p>
  );
}

function Cond({ c, mark }: { c: Condition; mark?: 'added' | 'removed' }) {
  return <span className="lab-cond" data-mark={mark}>{describeCondition(c)}</span>;
}

function ChangedCond({ ch }: { ch: ConditionChange }) {
  const from = ch.from!;
  const to = ch.to!;
  return (
    <span className="lab-cond" data-mark="changed">
      {to.f} {from.op !== to.op ? <><del>{OPS[from.op]}</del> <ins>{OPS[to.op]}</ins></> : OPS[to.op]}{' '}
      {from.v !== to.v ? <><del>{fmtNum(from.v)}</del> <ins>{fmtNum(to.v)}</ins></> : fmtNum(to.v)}
    </span>
  );
}

function ActionChip({ a, mark }: { a: Action; mark?: 'from' | 'to' }) {
  return <span className="lab-act" data-mark={mark}>{describeAction(a)}</span>;
}

export function RuleCard({ rule, mark }: { rule: Rule; mark?: 'added' | 'removed' | 'plain' }) {
  return (
    <li className="lab-rule" data-mark={mark ?? 'plain'}>
      <div className="lab-rule__head">
        <span className="lab-rule__sign" aria-hidden="true">{mark === 'added' ? '+' : mark === 'removed' ? '−' : ''}</span>
        <code className="lab-rule__id">{rule.id}</code>
        <span className="lab-rule__on">{KIND_LABEL[rule.on]} · p{rule.priority}</span>
      </div>
      <div className="lab-rule__body">
        {rule.when.length ? rule.when.map((c, i) => <Cond key={i} c={c} />) : <span className="lab-cond lab-cond--always">always</span>}
        <span className="lab-rule__then" aria-hidden="true">→</span>
        <ActionChip a={rule.do} />
      </div>
      {mark !== 'removed' && <Say text={rule.say} />}
    </li>
  );
}

function ChangedRule({ ch }: { ch: RuleChange }) {
  const byTo = new Map(ch.conditions.filter((c) => c.to).map((c) => [c.to!, c]));
  const removed = ch.conditions.filter((c) => c.kind === 'removed');
  const doChange = ch.fields.find((f) => f.field === 'do');
  const prio = ch.fields.find((f) => f.field === 'priority');
  const on = ch.fields.find((f) => f.field === 'on');
  const say = ch.fields.find((f) => f.field === 'say');
  return (
    <li className="lab-rule" data-mark="changed">
      <div className="lab-rule__head">
        <span className="lab-rule__sign" aria-hidden="true">~</span>
        <code className="lab-rule__id">{ch.id}</code>
        <span className="lab-rule__on">
          {on ? <><del>{KIND_LABEL[ch.before.on]}</del> <ins>{KIND_LABEL[ch.after.on]}</ins></> : KIND_LABEL[ch.on]}
          {' · '}
          {prio ? <><del>p{String(prio.from)}</del> <ins>p{String(prio.to)}</ins></> : `p${ch.after.priority}`}
        </span>
      </div>
      <div className="lab-rule__body">
        {ch.after.when.map((c, i) => {
          const x = byTo.get(c);
          if (!x) return <Cond key={i} c={c} />;
          return x.kind === 'added' ? <Cond key={i} c={c} mark="added" /> : <ChangedCond key={i} ch={x} />;
        })}
        {removed.map((x, i) => <Cond key={`r${i}`} c={x.from!} mark="removed" />)}
        <span className="lab-rule__then" aria-hidden="true">→</span>
        {doChange ? <><ActionChip a={ch.before.do} mark="from" /><ActionChip a={ch.after.do} mark="to" /></> : <ActionChip a={ch.after.do} />}
      </div>
      {say ? <Say text={ch.after.say} /> : null}
    </li>
  );
}

export interface DiffViewProps {
  title: string;
  /** null = no parent: list the policy's rules. */
  diff: PolicyDiff | null;
  policy: Policy;
}

export function DiffView({ title, diff, policy }: DiffViewProps) {
  return (
    <section className="lab-card lab-diff" aria-label="Rule diff">
      <header className="lab-card__head">
        <h3 className="lab-h3">{title}</h3>
        <span className="lab-chip lab-chip--quiet">{diff ? diffSummary(diff) : `${policy.rules.length} rule${policy.rules.length === 1 ? '' : 's'}`}</span>
      </header>
      <div className="lab-diff__scroll">
        {diff === null && (
          <ul className="lab-rules">{policy.rules.map((r) => <RuleCard key={r.id} rule={r} />)}</ul>
        )}
        {diff && diff.empty && <p className="lab-empty">Same rules and params as its parent.</p>}
        {diff && !diff.empty && (
          <>
            <ul className="lab-rules">
              {diff.added.map((r) => <RuleCard key={`a-${r.id}`} rule={r} mark="added" />)}
              {diff.changed.map((c) => <ChangedRule key={`c-${c.id}`} ch={c} />)}
              {diff.removed.map((r) => <RuleCard key={`r-${r.id}`} rule={r} mark="removed" />)}
            </ul>
            {(diff.params.length > 0 || diff.defaults.length > 0 || diff.advisor.length > 0) && (
              <ul className="lab-params">
                {diff.params.map((p) => (
                  <li key={p.path}><span>{paramLabel(p.path)}</span><del>{paramValue(p.path, p.from)}</del><ins>{paramValue(p.path, p.to)}</ins></li>
                ))}
                {diff.defaults.map((d) => (
                  <li key={d.kind}><span>default · {KIND_LABEL[d.kind]}</span><del>{describeAction(d.from)}</del><ins>{describeAction(d.to)}</ins></li>
                ))}
                {diff.advisor.map((p) => (
                  <li key={p.path}><span>{paramLabel(p.path)}</span><del>{paramValue(p.path, p.from)}</del><ins>{paramValue(p.path, p.to)}</ins></li>
                ))}
              </ul>
            )}
            {diff.unchanged > 0 && <p className="lab-diff__same">{diff.unchanged} other rule{diff.unchanged === 1 ? '' : 's'} unchanged</p>}
          </>
        )}
      </div>
    </section>
  );
}

export function ErrorsView({ title, errors }: { title: string; errors: string[] }) {
  return (
    <section className="lab-card lab-diff" aria-label="Validation errors">
      <header className="lab-card__head">
        <h3 className="lab-h3">{title}</h3>
        <span className="lab-chip lab-chip--bad">invalid</span>
      </header>
      <div className="lab-diff__scroll">
        <p className="lab-muted">The validator rejected this policy, so it never ran. The designer got one repair attempt.</p>
        <ul className="lab-errors">{errors.map((e, i) => <li key={i}><code>{e}</code></li>)}</ul>
      </div>
    </section>
  );
}
