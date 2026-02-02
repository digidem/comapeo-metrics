// TODO: Any other base fields?
type BaseMetricsEvent<Type = string> = {
	type: Type
}

export type CustomMetricsEvent<
	Type extends string,
	Data = Record<string, unknown>,
> = BaseMetricsEvent<Type> & { data: Data }

export type AppDiagnosticsEvent = CustomMetricsEvent<
	'app-diagnostics/v1',
	{
		appId?: string
		appLocale: string
		appName?: string
		country?: string
		deviceLocale: string
		nativeApplicationVersion?: string
		nativeBuildVersion?: string
		os: string
		osVersion: string | number
	}
>

export type DeviceDiagnosticsEvent = CustomMetricsEvent<
	'device-diagnostics/v1',
	{
		monthlyDeviceHash: string
		brand?: string
		deviceType?: string
		isEmulator?: string
		manufacturer?: string
		model?: string
		os: string
		screen: {
			height: number
			width: number
			pixelRatio: number
		}
		supportedCpuArchitectures?: Array<string>
		totalMemory?: number
	}
>

export type CoMapeoMetricsEvent =
	| AppDiagnosticsEvent
	| DeviceDiagnosticsEvent
	| CustomMetricsEvent<string>
