import type { CompanyProfile } from '../../preload/types'
import { getEntityType, TAX_FORM_LABELS } from '../../shared/entities'
import { getStateName } from '../../shared/states'

function CompanyHome({ company }: { company: CompanyProfile }): JSX.Element {
  const entity = getEntityType(company.entityType)
  return (
    <section className="panel">
      <h1>{company.name}</h1>
      <dl className="details">
        <dt>Entity type</dt>
        <dd>{entity.label}</dd>
        <dt>Federal tax return</dt>
        <dd>{TAX_FORM_LABELS[entity.taxForm]}</dd>
        <dt>Home state</dt>
        <dd>{getStateName(company.homeState)}</dd>
        <dt>Books start</dt>
        <dd>{company.booksStartDate}</dd>
        <dt>Company folder</dt>
        <dd className="path">{company.dir}</dd>
      </dl>
      <p className="muted">The chart of accounts appears here in unit 1d.</p>
    </section>
  )
}

export default CompanyHome
