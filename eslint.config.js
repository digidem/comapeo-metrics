import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { includeIgnoreFile } from '@eslint/compat'
import js from '@eslint/js'
import pluginVitest from '@vitest/eslint-plugin'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const gitignorePath = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'.gitignore',
)

const gitExcludePath = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'.git',
	'info',
	'exclude',
)

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	includeIgnoreFile(gitExcludePath),
	js.configs.recommended,
	{
		files: ['**/*.{js,ts}'],
		extends: [tseslint.configs.recommended],
		rules: {
			// Allow unused vars if prefixed with `_` (https://typescript-eslint.io/rules/no-unused-vars/)
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					args: 'all',
					argsIgnorePattern: '^_',
					caughtErrors: 'all',
					caughtErrorsIgnorePattern: '^_',
					destructuredArrayIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					ignoreRestSiblings: true,
				},
			],
		},
	},
	{
		name: 'test',
		files: ['**/*.test.{js,ts,jsx,tsx}'],
		extends: [pluginVitest.configs.recommended],
	},
	{
		name: 'node',
		languageOptions: {
			globals: {
				...globals.node,
				...globals.nodeBuiltin,
				...globals.worker,
			},
		},
	},
)
