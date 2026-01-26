import React, { useState, useCallback, useEffect } from 'react';
import { useForm, Controller, type SubmitHandler } from 'react-hook-form';
import { Box, Button, FormControl, Stack, TextField, Select, MenuItem, InputLabel, FormHelperText, type SelectChangeEvent } from '@mui/material';
import { useRequest } from 'ahooks';
import { useI18n, useTime } from '@milesight/shared/src/hooks';
import { objectToCamelCase } from '@milesight/shared/src/utils/tools';
import { linkDownload, genRandomString } from '@milesight/shared/src/utils/tools';
import { toast } from '@milesight/shared/src/components';
import { DateRangePickerValueType } from '@/components/date-range-picker';
import { DateRangePicker } from '@/components';
import { Breadcrumbs } from '@/components';
import { entityAPI, dashboardAPI, deviceAPI, awaitWrap, getResponseData, isRequestSuccess, type DashboardListProps } from '@/services/http';
import { ENTITY_TYPE } from '@/constants';
import { buildTelemetryPdf, type PdfReportRow, type PdfReportDeviceSection } from './utils/pdfReport';

import './style.less';

type FormData = {
    dashboardId?: ApiKey;
    reportTitle?: string;
    companyName?: string;
    dateRange?: DateRangePickerValueType | null;
};

type DeviceEntityGroup = {
    deviceId: ApiKey;
    deviceName: string;
    entities: Array<{
        entityId: ApiKey;
        entityName: string;
        entityKey: string;
        unit?: string;
    }>;
};

export default function ReportPage() {
    const { getIntlText } = useI18n();
    const { dayjs, getTimeFormat, timezone } = useTime();
    const [generating, setGenerating] = useState(false);
    const [dashboardName, setDashboardName] = useState<string>('');

    const { control, handleSubmit, watch, getValues } = useForm<FormData>({ 
        defaultValues: {
            dashboardId: undefined,
            reportTitle: '',
            companyName: '',
            dateRange: null,
        },
    });
    const dashboardId = watch('dashboardId');
    const dateRange = watch('dateRange');

    // Fetch dashboard list
    const {
        data: dashboardList,
        loading: loadingDashboards,
        run: fetchDashboards,
    } = useRequest(
        async () => {
            const [error, resp] = await awaitWrap(
                dashboardAPI.getDashboards({
                    name: '',
                }),
            );
            const data = getResponseData(resp);
            if (error || !data || !isRequestSuccess(resp)) return;
            return (objectToCamelCase(data) as unknown) as DashboardListProps[];
        },
        { 
            manual: true,
        },
    );

    // Fetch dashboard list on mount
    useEffect(() => {
        fetchDashboards();
    }, [fetchDashboards]);

    // Fetch dashboard detail when dashboard is selected
    useEffect(() => {
        if (dashboardId != null) {
            // Compare as strings since we convert to string in Select
            const selected = dashboardList?.find(d => {
                const dId = (d as any).dashboard_id;
                return String(dId) === String(dashboardId) || dId === dashboardId;
            });
            setDashboardName(selected?.name ?? '');
            console.log('Dashboard name updated:', selected?.name);
        } else {
            setDashboardName('');
        }
    }, [dashboardId, dashboardList]);

    const onGenerate: SubmitHandler<FormData> = useCallback(
        async (formData) => {
            // Get current form values to ensure we have the latest dashboardId
            const currentValues = getValues();
            // Try multiple sources: formData, currentValues, watch value
            const dbId = formData.dashboardId || currentValues.dashboardId || dashboardId;
            
            console.log('Form submit - formData.dashboardId:', formData.dashboardId, 'currentValues.dashboardId:', currentValues.dashboardId, 'watch dashboardId:', dashboardId, 'final dbId:', dbId);
            
            // Validate dashboardId is not undefined, null, or empty string
            if (!dbId || dbId === '' || dbId === 'undefined' || dbId === 'null' || String(dbId).trim() === '') {
                console.error('Dashboard ID is invalid:', dbId, 'formData:', formData, 'currentValues:', currentValues);
                toast.error(getIntlText('report.message.select_dashboard'));
                return;
            }
            
            const { reportTitle, companyName, dateRange: dr } = formData;
            
            const start = dr?.start?.valueOf();
            const end = dr?.end?.valueOf();
            if (start == null || end == null) {
                toast.error(getIntlText('report.message.select_date_range'));
                return;
            }
            setGenerating(true);
            try {
                // 1. Get dashboard detail (entity_ids)
                // Ensure id is converted to the correct type (number if needed)
                let dashboardIdForApi: ApiKey;
                if (typeof dbId === 'string') {
                    // Check if it's a valid number string
                    const trimmed = dbId.trim();
                    if (trimmed === '' || trimmed === 'undefined' || trimmed === 'null') {
                        console.error('Dashboard ID is invalid string:', dbId);
                        toast.error(getIntlText('report.message.select_dashboard'));
                        return;
                    }
                    const numValue = Number(trimmed);
                    if (!isNaN(numValue) && trimmed !== '') {
                        dashboardIdForApi = numValue;
                    } else {
                        // Keep as string if not a valid number
                        dashboardIdForApi = trimmed;
                    }
                } else if (typeof dbId === 'number') {
                    dashboardIdForApi = dbId;
                } else {
                    console.error('Dashboard ID has invalid type:', typeof dbId, dbId);
                    toast.error(getIntlText('report.message.select_dashboard'));
                    return;
                }
                
                // Final validation before API call
                if (dashboardIdForApi == null || dashboardIdForApi === '' || String(dashboardIdForApi).trim() === '') {
                    console.error('Dashboard ID is invalid after conversion:', dashboardIdForApi);
                    toast.error(getIntlText('report.message.select_dashboard'));
                    return;
                }
                
                console.log('Calling getDashboardDetail with id:', dashboardIdForApi, 'type:', typeof dashboardIdForApi);
                
                const [err1, resp1] = await awaitWrap(
                    dashboardAPI.getDashboardDetail({
                        id: dashboardIdForApi as ApiKey,
                    }),
                );
                if (err1 || !isRequestSuccess(resp1)) {
                    // Check if it's an authentication error
                    const errorCode = (resp1?.data as ApiResponse)?.error_code;
                    if (errorCode === 'authentication_failed') {
                        // Error handler will redirect to login, just return
                        return;
                    }
                    toast.error(getIntlText('report.message.dashboard_not_found'));
                    return;
                }
                const dashboardDetail = getResponseData(resp1) as { entity_ids?: ApiKey[]; name?: string } | null;
                const entityIds = dashboardDetail?.entity_ids ?? [];
                if (!entityIds.length) {
                    toast.error(getIntlText('report.message.no_entities_in_dashboard'));
                    return;
                }

                // 2. Get entities with device_id
                const [err2, resp2] = await awaitWrap(
                    entityAPI.advancedSearch({
                        page_size: 1000,
                        page_number: 1,
                        sorts: [{ direction: 'ASC' as const, property: 'key' }],
                        entity_filter: {
                            ENTITY_ID: { operator: 'ANY_EQUALS' as const, values: entityIds },
                            ENTITY_TYPE: { operator: 'ANY_EQUALS' as const, values: [ENTITY_TYPE.PROPERTY] },
                        },
                    }),
                );
                if (err2 || !isRequestSuccess(resp2)) {
                    // Check if it's an authentication error
                    const errorCode = (resp2?.data as ApiResponse)?.error_code;
                    if (errorCode === 'authentication_failed') {
                        return;
                    }
                    toast.error(getIntlText('report.message.failed_to_fetch_entities'));
                    return;
                }
                const entityData = getResponseData(resp2);
                if (!entityData || typeof entityData !== 'object') {
                    toast.error(getIntlText('report.message.failed_to_fetch_entities'));
                    return;
                }
                const entityDataCamel = objectToCamelCase(entityData) as { content?: Array<{
                    entityId: ApiKey;
                    entityKey: string;
                    entityName: string;
                    deviceId?: ApiKey;
                    entityValueAttribute?: { unit?: string };
                }> } | null;
                const entities = entityDataCamel?.content ?? [];

                // 3. Group entities by device_id and get unique device_ids
                const deviceIdSet = new Set<ApiKey>();
                const entityMap = new Map<ApiKey, typeof entities>();
                entities.forEach(entity => {
                    const did = entity.deviceId;
                    if (did) {
                        deviceIdSet.add(did);
                        if (!entityMap.has(did)) {
                            entityMap.set(did, []);
                        }
                        entityMap.get(did)!.push(entity);
                    }
                });

                const deviceIds = Array.from(deviceIdSet);
                if (!deviceIds.length) {
                    toast.error(getIntlText('report.message.no_devices_in_dashboard'));
                    return;
                }

                // 4. Get device names
                const [err3, resp3] = await awaitWrap(
                    deviceAPI.getList({
                        page_size: 1000,
                        page_number: 1,
                        id_list: deviceIds,
                    }),
                );
                if (err3 || !isRequestSuccess(resp3)) {
                    // Check if it's an authentication error
                    const errorCode = (resp3?.data as ApiResponse)?.error_code;
                    if (errorCode === 'authentication_failed') {
                        return;
                    }
                    toast.error(getIntlText('report.message.failed_to_fetch_devices'));
                    return;
                }
                const deviceData = getResponseData(resp3);
                if (!deviceData || typeof deviceData !== 'object') {
                    toast.error(getIntlText('report.message.failed_to_fetch_devices'));
                    return;
                }
                const deviceDataCamel = objectToCamelCase(deviceData) as { content?: Array<{
                    id: ApiKey;
                    name: string;
                }> } | null;
                const devices = deviceDataCamel?.content ?? [];
                const deviceNameMap = new Map<ApiKey, string>();
                devices.forEach(device => {
                    deviceNameMap.set(device.id, device.name);
                });

                // 5. Build device-entity groups
                const deviceGroups: DeviceEntityGroup[] = deviceIds.map(deviceId => ({
                    deviceId,
                    deviceName: deviceNameMap.get(deviceId) ?? `Device ${deviceId}`,
                    entities: (entityMap.get(deviceId) ?? []).map(entity => ({
                        entityId: entity.entityId,
                        entityName: entity.entityName,
                        entityKey: entity.entityKey,
                        unit: entity.entityValueAttribute?.unit,
                    })),
                }));

                // 6. Fetch aggregate data for each entity
                const deviceSections: PdfReportDeviceSection[] = [];
                for (const group of deviceGroups) {
                    const rows: PdfReportRow[] = [];
                    for (const entity of group.entities) {
                        const agg = async (t: 'LAST' | 'MIN' | 'MAX' | 'AVG') => {
                            const [err, resp] = await awaitWrap(
                                entityAPI.getAggregateHistory({
                                    entity_id: entity.entityId,
                                    start_timestamp: start,
                                    end_timestamp: end,
                                    aggregate_type: t,
                                }),
                            );
                            // Check if it's an authentication error
                            if (resp && !isRequestSuccess(resp)) {
                                const errorCode = (resp?.data as ApiResponse)?.error_code;
                                if (errorCode === 'authentication_failed') {
                                    // Error handler will redirect to login
                                    return NaN;
                                }
                            }
                            const d = !err && isRequestSuccess(resp) ? getResponseData(resp) : null;
                            return d?.value != null ? (typeof d.value === 'number' ? d.value : Number(d.value)) : NaN;
                        };

                        const [last, min, max, avg] = await Promise.all([
                            agg('LAST'),
                            agg('MIN'),
                            agg('MAX'),
                            agg('AVG'),
                        ]);

                        rows.push({
                            entityName: entity.entityName,
                            unit: entity.unit ?? '',
                            last,
                            min,
                            max,
                            avg,
                        });
                    }
                    if (rows.length > 0) {
                        deviceSections.push({
                            deviceName: group.deviceName,
                            rows,
                        });
                    }
                }

                if (deviceSections.length === 0) {
                    toast.error(getIntlText('report.message.no_data_in_range'));
                    return;
                }

                // 7. Generate PDF
                const dateRangeStr = `${getTimeFormat(dayjs(start), 'simpleDateFormat')} – ${getTimeFormat(dayjs(end), 'simpleDateFormat')}`;
                const generatedAt = getTimeFormat(dayjs(), 'fullDateTimeSecondFormat');
                const blob = buildTelemetryPdf({
                    title: reportTitle ?? '',
                    companyName: companyName ?? '',
                    dashboardName: dashboardName || (dashboardDetail as { name?: string } | null)?.name || '',
                    dateRange: dateRangeStr,
                    deviceSections,
                    generatedAt,
                    defaultTitle: getIntlText('report.pdf.default_title'),
                    generatedAtLabel: getIntlText('report.pdf.generated_at'),
                    ariotLabel: getIntlText('report.pdf.ariot'),
                    dashboardLabel: getIntlText('report.pdf.dashboard'),
                    deviceLabel: getIntlText('report.pdf.device'),
                    tableHeaders: {
                        entityName: getIntlText('report.table.entity_name'),
                        unit: getIntlText('report.table.unit'),
                        last: getIntlText('report.table.last'),
                        min: getIntlText('report.table.min'),
                        max: getIntlText('report.table.max'),
                        avg: getIntlText('report.table.avg'),
                    },
                });

                const fileName = `TelemetryReport_${getTimeFormat(dayjs(), 'simpleDateFormat').replace(/-/g, '_')}_${genRandomString(6, { upperCase: false, lowerCase: true })}.pdf`;
                linkDownload(blob, fileName);
                toast.success(getIntlText('report.message.success'));
            } catch (e) {
                console.error('PDF generation error:', e);
                toast.error(getIntlText('report.message.generate_failed'));
            } finally {
                setGenerating(false);
            }
        },
        [dashboardName, getIntlText, dayjs, getTimeFormat, getValues, dashboardId, dashboardList],
    );

    return (
        <div className="ms-main">
            <Breadcrumbs />
            <div className="ms-view ms-view-report">
                <Box
                    component="form"
                    onSubmit={handleSubmit(onGenerate)}
                    sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 2 }}
                >
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} flexWrap="wrap">
                        <Controller
                            name="dashboardId"
                            control={control}
                            rules={{ required: true }}
                            render={({ field, fieldState: { error } }) => (
                                <FormControl size="small" sx={{ minWidth: 280 }} error={!!error} required>
                                    <InputLabel id="dashboard-select-label">{getIntlText('report.form.dashboard')}</InputLabel>
                                    <Select
                                        labelId="dashboard-select-label"
                                        disabled={loadingDashboards || generating}
                                        displayEmpty
                                        value={field.value != null && field.value !== undefined && field.value !== '' ? String(field.value) : ''}
                                        onChange={(e: SelectChangeEvent<string>) => {
                                            const selectedValue = e.target.value;
                                            console.log('[Dashboard Select] onChange triggered - selectedValue:', selectedValue, 'dashboardList length:', dashboardList?.length);
                                            
                                            if (!selectedValue || selectedValue === '' || selectedValue === 'undefined' || selectedValue === 'null') {
                                                console.log('[Dashboard Select] Empty value, setting to undefined');
                                                field.onChange(undefined);
                                                return;
                                            }
                                            
                                            // Find the dashboard to get the original ID type
                                            const selectedDashboard = dashboardList?.find(d => {
                                                const dId = (d as any).dashboard_id;
                                                const dIdString = String(dId);
                                                const match = dIdString === selectedValue || dId === selectedValue;
                                                if (match) {
                                                    console.log('[Dashboard Select] Found dashboard - dId:', dId, 'dIdString:', dIdString, 'selectedValue:', selectedValue);
                                                }
                                                return match;
                                            });
                                            
                                            if (!selectedDashboard) {
                                                console.error('[Dashboard Select] Dashboard not found for value:', selectedValue, 'Available dashboards:', dashboardList?.map(d => ({ id: (d as any).dashboard_id, name: d.name })));
                                                field.onChange(undefined);
                                                return;
                                            }
                                            
                                            const originalId = (selectedDashboard as any).dashboard_id;
                                            console.log('[Dashboard Select] Setting field value to original ID:', originalId, 'Type:', typeof originalId);
                                            
                                            // Use the original ID type (number or string) from the dashboard object
                                            field.onChange(originalId as ApiKey);
                                            
                                            // Verify the update
                                            setTimeout(() => {
                                                const updatedValue = getValues('dashboardId');
                                                const watchValue = watch('dashboardId');
                                                console.log('[Dashboard Select] After onChange - getValues:', updatedValue, 'watch:', watchValue, 'field.value:', field.value);
                                            }, 50);
                                        }}
                                        onBlur={field.onBlur}
                                        name={field.name}
                                        inputRef={field.ref}
                                    >
                                        {dashboardList && dashboardList.length > 0 ? (
                                            dashboardList.map(dashboard => {
                                                const dashboardId = (dashboard as any).dashboard_id;
                                                // Ensure value is string for Material-UI Select
                                                const stringId = String(dashboardId);
                                                return (
                                                    <MenuItem key={stringId} value={stringId}>
                                                        {dashboard.name}
                                                    </MenuItem>
                                                );
                                            })
                                        ) : (
                                            <MenuItem disabled value="">
                                                {loadingDashboards ? getIntlText('common.loading') : getIntlText('report.message.no_dashboards')}
                                            </MenuItem>
                                        )}
                                    </Select>
                                    {error && <FormHelperText>{getIntlText('report.message.select_dashboard')}</FormHelperText>}
                                </FormControl>
                            )}
                        />
                        <Controller
                            name="reportTitle"
                            control={control}
                            render={({ field }) => (
                                <TextField
                                    {...field}
                                    label={getIntlText('report.form.report_title')}
                                    placeholder={getIntlText('report.form.report_title_placeholder')}
                                    size="small"
                                    sx={{ minWidth: 220 }}
                                    disabled={generating}
                                />
                            )}
                        />
                        <Controller
                            name="companyName"
                            control={control}
                            render={({ field }) => (
                                <TextField
                                    {...field}
                                    label={getIntlText('report.form.company_name')}
                                    placeholder={getIntlText('report.form.company_name_placeholder')}
                                    size="small"
                                    sx={{ minWidth: 220 }}
                                    disabled={generating}
                                />
                            )}
                        />
                        <Controller
                            name="dateRange"
                            control={control}
                            render={({ field: { onChange, value } }) => (
                                <FormControl size="small" sx={{ minWidth: 280 }}>
                                    <DateRangePicker
                                        label={{
                                            start: getIntlText('common.label.start_date'),
                                            end: getIntlText('common.label.end_date'),
                                        }}
                                        value={value as DateRangePickerValueType | null}
                                        onChange={onChange}
                                        disabled={generating}
                                    />
                                </FormControl>
                            )}
                        />
                        <Button
                            type="submit"
                            variant="contained"
                            disabled={generating || !dashboardId || dashboardId === '' || dashboardId === 'undefined'}
                            sx={{ height: 40, textTransform: 'none' }}
                        >
                            {generating
                                ? getIntlText('report.form.generate_pdf_loading')
                                : getIntlText('report.form.generate_pdf')}
                        </Button>
                    </Stack>
                </Box>
            </div>
        </div>
    );
}
