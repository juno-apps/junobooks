// Smoke check: app opens, creates the Live check company, shows its home screen.
import { launch, createCompany, shot, check, done } from '../lib.mjs'

const { app, page, errors } = await launch({ fresh: true })
await createCompany(page)
check(await page.getByRole('button', { name: 'New expense' }).isVisible(), 'company home shows New expense')
console.log(await shot(page, 'smoke-home'))
await app.close()
done(errors)
