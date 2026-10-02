/** Year-end detail reports (added in units 9b and 9c). */
export type ExtraTab = never

export const EXTRA_TABS: { id: ExtraTab; label: string }[] = []

function ExtraReports(_props: {
  tab: ExtraTab
  firstYear: number
  onMsg: (m: { text: string; bad: boolean } | null) => void
}): JSX.Element {
  return <></>
}

export default ExtraReports
