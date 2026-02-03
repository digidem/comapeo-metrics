import { execa } from 'execa'

const projectDir = import.meta.dirname

const $ = execa({
	preferLocal: true,
	cwd: projectDir,
	stdout: process.stderr,
	stderr: process.stderr,
})

export async function setup() {
	process.stderr.write(`Starting Supabase... (${projectDir})\n`)
	await $`pnpm exec supabase start`
	await $`pnpm exec supabase db reset`
}
