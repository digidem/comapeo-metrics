export class InvalidJsonError extends Error {
	code = 'INVALID_JSON'
	status = 400
	constructor(msg?: string, { cause }: { cause?: unknown } = {}) {
		super(msg, { cause })
	}
}
export class PayloadTooLargeError extends Error {
	code = 'PAYLOAD_TOO_LARGE'
	status = 413
	constructor(msg?: string) {
		super(msg)
	}
}
export class LineTooLargeError extends Error {
	code = 'LINE_TOO_LARGE'
	status = 413
	constructor(msg?: string) {
		super(msg)
	}
}
