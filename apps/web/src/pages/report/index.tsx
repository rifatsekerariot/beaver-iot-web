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
import { getDeviceIdsInuse } from '@/components/drawing-board/utils';
import type { WidgetDetail } from '@/services/http/dashboard';
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

    const { control, handleSubmit, watch, getValues, setValue } = useForm<FormData>({ 
        defaultValues: {
            dashboardId: undefined,
            reportTitle: '',
            companyName: '',
            dateRange: null,
        },
        mode: 'onChange', // Validate on change
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
            console.log('[ReportPage] [API] Starting fetchDashboards API call...');
            const [error, resp] = await awaitWrap(
                dashboardAPI.getDashboards({
                    name: '',
                }),
            );
            console.log('[ReportPage] [API] fetchDashboards response - error:', error, 'resp:', resp);
            
            const data = getResponseData(resp);
            console.log('[ReportPage] [API] fetchDashboards - extracted data:', data, 'isRequestSuccess:', isRequestSuccess(resp));
            
            if (error || !data || !isRequestSuccess(resp)) {
                console.error('[ReportPage] [API] fetchDashboards failed - error:', error, 'data:', data, 'resp:', resp);
                return;
            }
            // Use raw response (snake_case). objectToCamelCase breaks dashboard_id -> undefined.
            const list = (Array.isArray(data) ? data : (data as any)?.data ?? data) as DashboardListProps[];
            console.log('[ReportPage] [API] fetchDashboards success - count:', list?.length, 'dashboards:', list?.map(d => ({ id: d.dashboard_id, name: d.name })));
            return list;
        },
        { 
            manual: true,
        },
    );

    // Fetch dashboard list on mount
    useEffect(() => {
        console.log('[ReportPage] Component mounted, fetching dashboards...');
        fetchDashboards();
    }, [fetchDashboards]);
    
    // Debug: Log dashboard list when it changes
    useEffect(() => {
        if (dashboardList) {
            console.log('[ReportPage] Dashboard list updated:', dashboardList.length, 'dashboards:', dashboardList.map(d => ({ id: d.dashboard_id, name: d.name })));
        }
    }, [dashboardList]);

    // Fetch dashboard detail when dashboard is selected
    useEffect(() => {
        console.log('[ReportPage] dashboardId changed:', dashboardId, 'Type:', typeof dashboardId);
        if (dashboardId != null && dashboardId !== '' && dashboardId !== 'undefined') {
            // Compare as strings since we convert to string in Select
            const selected = dashboardList?.find(d => {
                const dId = d.dashboard_id;
                const match = String(dId) === String(dashboardId) || dId === dashboardId;
                if (match) {
                    console.log('[ReportPage] Found matching dashboard:', { dId, dashboardId, name: d.name });
                }
                return match;
            });
            const name = selected?.name ?? '';
            setDashboardName(name);
            console.log('[ReportPage] Dashboard name updated:', name);
        } else {
            setDashboardName('');
            console.log('[ReportPage] Dashboard ID is null/empty, clearing dashboard name');
        }
    }, [dashboardId, dashboardList]);

    const onGenerate: SubmitHandler<FormData> = useCallback(
        async (formData) => {
            console.log('[ReportPage] [FORM] ========== FORM SUBMIT STARTED ==========');
            console.log('[ReportPage] [FORM] formData:', JSON.stringify(formData, null, 2));
            
            // Get current form values to ensure we have the latest dashboardId
            const currentValues = getValues();
            console.log('[ReportPage] [FORM] currentValues (getValues):', JSON.stringify(currentValues, null, 2));
            console.log('[ReportPage] [FORM] watch dashboardId:', dashboardId, 'Type:', typeof dashboardId);
            
            // Try multiple sources: formData, currentValues, watch value
            const dbId = formData.dashboardId || currentValues.dashboardId || dashboardId;
            console.log('[ReportPage] [FORM] Dashboard ID resolution:');
            console.log('[ReportPage] [FORM]   - formData.dashboardId:', formData.dashboardId, 'Type:', typeof formData.dashboardId);
            console.log('[ReportPage] [FORM]   - currentValues.dashboardId:', currentValues.dashboardId, 'Type:', typeof currentValues.dashboardId);
            console.log('[ReportPage] [FORM]   - watch dashboardId:', dashboardId, 'Type:', typeof dashboardId);
            console.log('[ReportPage] [FORM]   - final dbId:', dbId, 'Type:', typeof dbId);
            
            // Validate dashboardId is not undefined, null, or empty string
            if (!dbId || dbId === '' || dbId === 'undefined' || dbId === 'null' || String(dbId).trim() === '') {
                console.error('[ReportPage] [FORM] ❌ Dashboard ID validation failed:', dbId);
                console.error('[ReportPage] [FORM] formData:', formData);
                console.error('[ReportPage] [FORM] currentValues:', currentValues);
                toast.error(getIntlText('report.message.select_dashboard'));
                return;
            }
            console.log('[ReportPage] [FORM] ✅ Dashboard ID validation passed:', dbId);
            
            const { reportTitle, companyName, dateRange: dr } = formData;
            console.log('[ReportPage] [FORM] Form fields - reportTitle:', reportTitle, 'companyName:', companyName, 'dateRange:', dr);
            
            const start = dr?.start?.valueOf();
            const end = dr?.end?.valueOf();
            console.log('[ReportPage] [FORM] Date range - start:', start, 'end:', end);
            if (start == null || end == null) {
                console.error('[ReportPage] [FORM] ❌ Date range validation failed');
                toast.error(getIntlText('report.message.select_date_range'));
                return;
            }
            console.log('[ReportPage] [FORM] ✅ Date range validation passed');
            
            console.log('[ReportPage] [FORM] Setting generating=true');
            setGenerating(true);
            try {
                console.log('[ReportPage] [API] ========== API CALLS STARTING ==========');
                
                // 1. Get dashboard detail (entity_ids)
                // Ensure id is converted to the correct type (number if needed)
                console.log('[ReportPage] [API] Step 1: Converting dashboard ID for API...');
                console.log('[ReportPage] [API]   - dbId:', dbId, 'Type:', typeof dbId);
                
                let dashboardIdForApi: ApiKey;
                if (typeof dbId === 'string') {
                    // Check if it's a valid number string
                    const trimmed = dbId.trim();
                    if (trimmed === '' || trimmed === 'undefined' || trimmed === 'null') {
                        console.error('[ReportPage] [API] ❌ Dashboard ID is invalid string:', dbId);
                        toast.error(getIntlText('report.message.select_dashboard'));
                        return;
                    }
                    const numValue = Number(trimmed);
                    if (!isNaN(numValue) && trimmed !== '') {
                        dashboardIdForApi = numValue;
                        console.log('[ReportPage] [API]   - Converted string to number:', dashboardIdForApi);
                    } else {
                        // Keep as string if not a valid number
                        dashboardIdForApi = trimmed;
                        console.log('[ReportPage] [API]   - Kept as string:', dashboardIdForApi);
                    }
                } else if (typeof dbId === 'number') {
                    dashboardIdForApi = dbId;
                    console.log('[ReportPage] [API]   - Already number:', dashboardIdForApi);
                } else {
                    console.error('[ReportPage] [API] ❌ Dashboard ID has invalid type:', typeof dbId, dbId);
                    toast.error(getIntlText('report.message.select_dashboard'));
                    return;
                }
                
                // Final validation before API call
                if (dashboardIdForApi == null || dashboardIdForApi === '' || String(dashboardIdForApi).trim() === '') {
                    console.error('[ReportPage] [API] ❌ Dashboard ID is invalid after conversion:', dashboardIdForApi);
                    toast.error(getIntlText('report.message.select_dashboard'));
                    return;
                }
                console.log('[ReportPage] [API] ✅ Dashboard ID for API:', dashboardIdForApi, 'Type:', typeof dashboardIdForApi);
                
                // Use getDrawingBoardDetail(canvas_id) instead of getDashboardDetail(id).
                // GET /dashboard/:id returns 500 (backend "GET not supported"); GET /canvas/:canvas_id works.
                const selectedDashboard = dashboardList?.find(
                    d => String(d.dashboard_id) === String(dashboardIdForApi) || d.dashboard_id === dashboardIdForApi,
                );
                const mainCanvasId = selectedDashboard?.main_canvas_id;
                if (!mainCanvasId && mainCanvasId !== 0) {
                    console.error('[ReportPage] [API] ❌ main_canvas_id not found for dashboard:', dashboardIdForApi);
                    toast.error(getIntlText('report.message.dashboard_not_found'));
                    return;
                }
                console.log('[ReportPage] [API] Step 1.1: Calling getDrawingBoardDetail (GET /canvas/:id)...');
                console.log('[ReportPage] [API]   - canvas_id:', mainCanvasId);
                
                const [err1, resp1] = await awaitWrap(
                    dashboardAPI.getDrawingBoardDetail({
                        canvas_id: mainCanvasId as ApiKey,
                    }),
                );
                
                console.log('[ReportPage] [API] Step 1.2: getDrawingBoardDetail response received');
                console.log('[ReportPage] [API]   - error:', err1);
                console.log('[ReportPage] [API]   - response:', resp1);
                console.log('[ReportPage] [API]   - isRequestSuccess:', isRequestSuccess(resp1));
                
                if (err1 || !isRequestSuccess(resp1)) {
                    console.error('[ReportPage] [API] ❌ getDrawingBoardDetail failed');
                    console.error('[ReportPage] [API]   - error:', err1);
                    console.error('[ReportPage] [API]   - response:', resp1);
                    
                    const errorCode = (resp1?.data as ApiResponse)?.error_code;
                    console.log('[ReportPage] [API]   - error_code:', errorCode);
                    if (errorCode === 'authentication_failed') {
                        console.log('[ReportPage] [API]   - Authentication failed, redirecting to login...');
                        return;
                    }
                    toast.error(getIntlText('report.message.dashboard_not_found'));
                    return;
                }
                
                type NormalizedEntity = { entityId: ApiKey; entityKey: string; entityName: string; deviceId?: ApiKey; entityValueAttribute?: { unit?: string } };
                const canvasDetail = getResponseData(resp1) as {
                    entity_ids?: ApiKey[];
                    entities?: Array<{
                        id?: ApiKey;
                        entity_id?: ApiKey;
                        key?: string;
                        entity_key?: string;
                        name?: string;
                        entity_name?: string;
                        device_id?: ApiKey;
                        value_attribute?: { unit?: string };
                        entity_value_attribute?: { unit?: string };
                    }>;
                    widgets?: WidgetDetail[];
                    device_ids?: ApiKey[];
                    name?: string;
                } | null;
                console.log('[ReportPage] [API] ✅ getDrawingBoardDetail success');
                console.log('[ReportPage] [API]   - canvasDetail:', canvasDetail);
                const entityIds = canvasDetail?.entity_ids ?? [];
                const rawEntities = canvasDetail?.entities ?? [];
                const widgets = (canvasDetail?.widgets ?? []) as WidgetDetail[];
                console.log('[ReportPage] [API]   - entity_ids:', entityIds, 'count:', entityIds.length);
                console.log('[ReportPage] [API]   - entities:', rawEntities?.length ?? 0);
                console.log('[ReportPage] [API]   - widgets:', widgets?.length ?? 0);

                const entityIdSet = new Set<string>();
                const addId = (id: ApiKey | null | undefined) => {
                    if (id != null && String(id).trim() !== '') entityIdSet.add(String(id));
                };
                entityIds.forEach(addId);
                if (rawEntities.length && !entityIds.length) {
                    rawEntities.forEach(e => addId((e.id ?? e.entity_id) as ApiKey));
                }
                const scan = (obj: unknown): void => {
                    if (obj == null || typeof obj !== 'object') return;
                    const o = obj as Record<string, unknown>;
                    const id = o.entity_id ?? o.entityId ?? (o.entity && typeof o.entity === 'object' && (o.entity as Record<string, unknown>).value);
                    if (id != null && (typeof id === 'string' || typeof id === 'number')) addId(id as ApiKey);
                    if (Array.isArray(o.entities)) o.entities.forEach((e: unknown) => scan(e));
                    if (Array.isArray(o.entityList)) o.entityList.forEach((e: unknown) => scan(e));
                    if (o.data && typeof o.data === 'object') scan(o.data);
                };
                widgets.forEach(w => scan(w.data));

                let entities: NormalizedEntity[] = [];

                if (rawEntities.length > 0) {
                    const mapped: NormalizedEntity[] = rawEntities.flatMap(
                        (e: Record<string, unknown>): NormalizedEntity[] => {
                            const id = (e.id ?? e.entity_id) as ApiKey | undefined;
                            if (!id) return [];
                            const key = String(e.key ?? e.entity_key ?? '');
                            const name = String(e.name ?? e.entity_name ?? '');
                            const deviceId = (e.device_id as ApiKey | undefined) ?? undefined;
                            const va = (e.value_attribute ?? e.entity_value_attribute) as { unit?: string } | undefined;
                            return [{ entityId: id, entityKey: key, entityName: name, deviceId, entityValueAttribute: va }];
                        },
                    );
                    const withDevice = mapped.filter((e): e is NormalizedEntity & { deviceId: ApiKey } => e.deviceId != null);
                    if (withDevice.length > 0) {
                        console.log('[ReportPage] [API] Using canvas.entities (skip API), count:', withDevice.length);
                        entities = withDevice;
                    }
                }

                if (entities.length === 0) {
                    let deviceIds: ApiKey[] = Array.from(
                        new Set([
                            ...(canvasDetail?.device_ids ?? []),
                            ...(getDeviceIdsInuse(widgets) ?? []),
                        ]),
                    ).filter(Boolean);
                    if (deviceIds.length === 0) {
                        console.log('[ReportPage] [API] Step 2a: No device_ids from canvas/widgets, fetching all devices...');
                        const [errDev, respDev] = await awaitWrap(
                            deviceAPI.getList({ page_size: 100, page_number: 1 }),
                        );
                        if (errDev || !isRequestSuccess(respDev)) {
                            console.error('[ReportPage] [API] ❌ deviceAPI.getList (all) failed');
                            toast.error(getIntlText('report.message.failed_to_fetch_entities'));
                            return;
                        }
                        const devData = getResponseData(respDev) as { content?: Array<{ id?: ApiKey }> } | null;
                        deviceIds = (devData?.content ?? []).map(d => d.id).filter(Boolean) as ApiKey[];
                        console.log('[ReportPage] [API]   - devices from getList:', deviceIds.length);
                    }
                    if (deviceIds.length === 0) {
                        console.error('[ReportPage] [API] ❌ No devices available for entity fetch');
                        toast.error(getIntlText('report.message.no_entities_in_dashboard'));
                        return;
                    }
                    const cap = 50;
                    const idsToQuery = deviceIds.slice(0, cap);
                    console.log('[ReportPage] [API] Step 2b: Fetching entities per device (DEVICE_ID EQ, like Device Entity Data), devices:', idsToQuery.length);

                    const allRaw: NormalizedEntity[] = [];
                    for (const did of idsToQuery) {
                        const [err2, r2] = await awaitWrap(
                            entityAPI.advancedSearch({
                                page_size: 1000,
                                page_number: 1,
                                sorts: [{ direction: 'ASC' as const, property: 'key' }],
                                entity_filter: {
                                    DEVICE_ID: { operator: 'EQ' as const, values: [did] },
                                    ENTITY_TYPE: { operator: 'ANY_EQUALS' as const, values: [ENTITY_TYPE.PROPERTY] },
                                },
                            }),
                        );
                        if (err2 || !isRequestSuccess(r2)) {
                            console.warn('[ReportPage] [API] advancedSearch(DEVICE_ID EQ) failed for device:', did, err2);
                            continue;
                        }
                        const entityData = getResponseData(r2);
                        const list = Array.isArray((entityData as any)?.content)
                            ? (entityData as any).content
                            : Array.isArray((entityData as any)?.data)
                              ? (entityData as any).data
                              : [];
                        list.forEach((item: Record<string, unknown>) => {
                            const id = (item.id ?? item.entity_id) as ApiKey | undefined;
                            if (!id) return;
                            const key = String(item.key ?? item.entity_key ?? '');
                            const name = String(item.name ?? item.entity_name ?? '');
                            const deviceId = (item.device_id as ApiKey | undefined) ?? (did as ApiKey);
                            const va = (item.value_attribute ?? item.entity_value_attribute) as { unit?: string } | undefined;
                            allRaw.push({ entityId: id, entityKey: key, entityName: name, deviceId, entityValueAttribute: va });
                        });
                    }
                    if (entityIdSet.size > 0) {
                        entities = allRaw.filter(e => entityIdSet.has(String(e.entityId)));
                        console.log('[ReportPage] [API]   - filtered by entity_ids:', entities.length, 'of', allRaw.length);
                    } else {
                        entities = allRaw;
                    }
                    console.log('[ReportPage] [API] ✅ entities fetched by DEVICE_ID (EQ per device), count:', entities.length);
                }

                if (!entities.length) {
                    console.error('[ReportPage] [API] ❌ No entities in dashboard');
                    toast.error(getIntlText('report.message.no_entities_in_dashboard'));
                    return;
                }
                console.log('[ReportPage] [API] ✅ Using', entities.length, 'entities');

                // 3. Group entities by device_id and get unique device_ids
                console.log('[ReportPage] [API] Step 3: Grouping entities by device_id...');
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
                console.log('[ReportPage] [API]   - deviceIdSet size:', deviceIdSet.size);

                const deviceIds = Array.from(deviceIdSet);
                console.log('[ReportPage] [API]   - deviceIds:', deviceIds);
                if (!deviceIds.length) {
                    console.error('[ReportPage] [API] ❌ No devices found in entities');
                    toast.error(getIntlText('report.message.no_devices_in_dashboard'));
                    return;
                }
                console.log('[ReportPage] [API] ✅ Found', deviceIds.length, 'devices');

                // 4. Get device names
                console.log('[ReportPage] [API] Step 4: Calling deviceAPI.getList...');
                console.log('[ReportPage] [API]   - Request: deviceIds:', deviceIds);
                
                const [err3, resp3] = await awaitWrap(
                    deviceAPI.getList({
                        page_size: 1000,
                        page_number: 1,
                        id_list: deviceIds,
                    }),
                );
                
                console.log('[ReportPage] [API] Step 4.1: deviceAPI.getList response received');
                console.log('[ReportPage] [API]   - error:', err3);
                console.log('[ReportPage] [API]   - response:', resp3);
                console.log('[ReportPage] [API]   - isRequestSuccess:', isRequestSuccess(resp3));
                
                if (err3 || !isRequestSuccess(resp3)) {
                    console.error('[ReportPage] [API] ❌ deviceAPI.getList failed');
                    console.error('[ReportPage] [API]   - error:', err3);
                    console.error('[ReportPage] [API]   - response:', resp3);
                    
                    // Check if it's an authentication error
                    const errorCode = (resp3?.data as ApiResponse)?.error_code;
                    console.log('[ReportPage] [API]   - error_code:', errorCode);
                    if (errorCode === 'authentication_failed') {
                        console.log('[ReportPage] [API]   - Authentication failed, redirecting to login...');
                        return;
                    }
                    toast.error(getIntlText('report.message.failed_to_fetch_devices'));
                    return;
                }
                
                const deviceData = getResponseData(resp3);
                console.log('[ReportPage] [API] ✅ deviceAPI.getList success');
                console.log('[ReportPage] [API]   - deviceData:', deviceData);
                
                if (!deviceData || typeof deviceData !== 'object') {
                    console.error('[ReportPage] [API] ❌ deviceData is invalid:', deviceData);
                    toast.error(getIntlText('report.message.failed_to_fetch_devices'));
                    return;
                }
                console.log('[ReportPage] [API] ✅ deviceData is valid object');
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
                console.log('[ReportPage] [API] Step 6: Fetching aggregate data for entities...');
                console.log('[ReportPage] [API]   - deviceGroups count:', deviceGroups.length);
                console.log('[ReportPage] [API]   - Date range: start:', start, 'end:', end);
                
                const deviceSections: PdfReportDeviceSection[] = [];
                for (const group of deviceGroups) {
                    console.log('[ReportPage] [API]   - Processing device:', group.deviceName, 'entities:', group.entities.length);
                    const rows: PdfReportRow[] = [];
                    for (const entity of group.entities) {
                        console.log('[ReportPage] [API]     - Fetching aggregate for entity:', entity.entityName, 'id:', entity.entityId);
                        
                        const agg = async (t: 'LAST' | 'MIN' | 'MAX' | 'AVG') => {
                            console.log('[ReportPage] [API]       - Calling getAggregateHistory:', t, 'entity_id:', entity.entityId);
                            const [err, resp] = await awaitWrap(
                                entityAPI.getAggregateHistory({
                                    entity_id: entity.entityId,
                                    start_timestamp: start,
                                    end_timestamp: end,
                                    aggregate_type: t,
                                }),
                            );
                            
                            console.log('[ReportPage] [API]       - getAggregateHistory response:', t, 'error:', err, 'isRequestSuccess:', resp ? isRequestSuccess(resp) : false);
                            
                            // Check if it's an authentication error
                            if (resp && !isRequestSuccess(resp)) {
                                const errorCode = (resp?.data as ApiResponse)?.error_code;
                                console.log('[ReportPage] [API]       - error_code:', errorCode);
                                if (errorCode === 'authentication_failed') {
                                    console.log('[ReportPage] [API]       - Authentication failed, redirecting to login...');
                                    // Error handler will redirect to login
                                    return NaN;
                                }
                            }
                            const d = !err && isRequestSuccess(resp) ? getResponseData(resp) : null;
                            const value = d?.value != null ? (typeof d.value === 'number' ? d.value : Number(d.value)) : NaN;
                            console.log('[ReportPage] [API]       - getAggregateHistory result:', t, 'value:', value);
                            return value;
                        };

                        const [last, min, max, avg] = await Promise.all([
                            agg('LAST'),
                            agg('MIN'),
                            agg('MAX'),
                            agg('AVG'),
                        ]);

                        console.log('[ReportPage] [API]     - Aggregate values for', entity.entityName, ':', { last, min, max, avg });

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
                        console.log('[ReportPage] [API]   - ✅ Added', rows.length, 'rows for device:', group.deviceName);
                        deviceSections.push({
                            deviceName: group.deviceName,
                            rows,
                        });
                    } else {
                        console.log('[ReportPage] [API]   - ⚠️ No rows for device:', group.deviceName);
                    }
                }
                
                console.log('[ReportPage] [API] ✅ Aggregate data fetch completed');
                console.log('[ReportPage] [API]   - deviceSections count:', deviceSections.length);

                if (deviceSections.length === 0) {
                    console.error('[ReportPage] [API] ❌ No device sections with data');
                    toast.error(getIntlText('report.message.no_data_in_range'));
                    return;
                }
                console.log('[ReportPage] [API] ✅ Found', deviceSections.length, 'device sections with data');

                // 7. Generate PDF
                console.log('[ReportPage] [PDF] Step 7: Generating PDF...');
                const dateRangeStr = `${getTimeFormat(dayjs(start), 'simpleDateFormat')} – ${getTimeFormat(dayjs(end), 'simpleDateFormat')}`;
                const generatedAt = getTimeFormat(dayjs(), 'fullDateTimeSecondFormat');
                console.log('[ReportPage] [PDF]   - dateRangeStr:', dateRangeStr);
                console.log('[ReportPage] [PDF]   - generatedAt:', generatedAt);
                console.log('[ReportPage] [PDF]   - reportTitle:', reportTitle);
                console.log('[ReportPage] [PDF]   - companyName:', companyName);
                console.log('[ReportPage] [PDF]   - dashboardName:', dashboardName);
                console.log('[ReportPage] [PDF]   - deviceSections count:', deviceSections.length);
                
                const blob = buildTelemetryPdf({
                    title: reportTitle ?? '',
                    companyName: companyName ?? '',
                    dashboardName: dashboardName || (canvasDetail as { name?: string } | null)?.name || '',
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
                console.log('[ReportPage] [PDF]   - fileName:', fileName);
                console.log('[ReportPage] [PDF]   - Downloading PDF...');
                
                linkDownload(blob, fileName);
                console.log('[ReportPage] [PDF] ✅ PDF download initiated');
                console.log('[ReportPage] [FORM] ========== FORM SUBMIT SUCCESS ==========');
                toast.success(getIntlText('report.message.success'));
            } catch (e) {
                console.error('[ReportPage] [ERROR] ========== PDF GENERATION ERROR ==========');
                console.error('[ReportPage] [ERROR] Error:', e);
                console.error('[ReportPage] [ERROR] Error stack:', e instanceof Error ? e.stack : 'No stack trace');
                console.error('[ReportPage] [ERROR] ============================================');
                toast.error(getIntlText('report.message.generate_failed'));
            } finally {
                console.log('[ReportPage] [FORM] Setting generating=false');
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
                            rules={{ required: getIntlText('report.message.select_dashboard') }}
                            render={({ field, fieldState: { error } }) => {
                                // Convert field value to string for Select component
                                const selectValue = field.value != null && field.value !== undefined ? String(field.value) : '';
                                
                                return (
                                    <FormControl size="small" sx={{ minWidth: 280 }} error={!!error} required>
                                        <InputLabel id="dashboard-select-label">{getIntlText('report.form.dashboard')}</InputLabel>
                                        <Select
                                            labelId="dashboard-select-label"
                                            disabled={loadingDashboards || generating}
                                            displayEmpty
                                            value={selectValue}
                                        onChange={(e: SelectChangeEvent<string>) => {
                                            const selectedValue = e.target.value;
                                            console.log('[ReportPage] [SELECT] ========== DASHBOARD SELECT onChange ==========');
                                            console.log('[ReportPage] [SELECT] selectedValue:', selectedValue, 'Type:', typeof selectedValue);
                                            console.log('[ReportPage] [SELECT] current field.value:', field.value, 'Type:', typeof field.value);
                                            console.log('[ReportPage] [SELECT] dashboardList length:', dashboardList?.length);
                                            
                                            // Handle empty selection
                                            if (!selectedValue || selectedValue === '') {
                                                console.log('[ReportPage] [SELECT] Empty selection, setting to undefined');
                                                field.onChange(undefined);
                                                console.log('[ReportPage] [SELECT] After onChange - field.value:', field.value);
                                                return;
                                            }
                                            
                                            // Find dashboard in list by matching string ID
                                            console.log('[ReportPage] [SELECT] Searching for dashboard in list...');
                                            const foundDashboard = dashboardList?.find(d => {
                                                const dId = d.dashboard_id;
                                                const dIdString = String(dId);
                                                const match = dIdString === selectedValue;
                                                if (match) {
                                                    console.log('[ReportPage] [SELECT]   - Match found:', { dId, dIdString, selectedValue, name: d.name });
                                                }
                                                return match;
                                            });
                                            
                                            if (!foundDashboard) {
                                                console.error('[ReportPage] [SELECT] ❌ Dashboard not found for value:', selectedValue);
                                                console.error('[ReportPage] [SELECT] Available dashboards:', dashboardList?.map(d => ({ 
                                                    id: d.dashboard_id, 
                                                    idString: String(d.dashboard_id),
                                                    name: d.name 
                                                })));
                                                field.onChange(undefined);
                                                console.log('[ReportPage] [SELECT] After onChange (not found) - field.value:', field.value);
                                                return;
                                            }
                                            
                                            // Get original ID from dashboard object (preserve type: number or string)
                                            const originalId = foundDashboard.dashboard_id;
                                            console.log('[ReportPage] [SELECT] ✅ Found dashboard:', foundDashboard.name);
                                            console.log('[ReportPage] [SELECT]   - originalId:', originalId, 'Type:', typeof originalId);
                                            
                                            // Update form state with original ID
                                            console.log('[ReportPage] [SELECT] Calling field.onChange with:', originalId);
                                            field.onChange(originalId as ApiKey);
                                            
                                            // Verify the update immediately
                                            console.log('[ReportPage] [SELECT] After field.onChange - field.value:', field.value, 'Type:', typeof field.value);
                                            console.log('[ReportPage] [SELECT] ============================================');
                                        }}
                                            onBlur={field.onBlur}
                                            name={field.name}
                                            inputRef={field.ref}
                                        >
                                            {dashboardList && dashboardList.length > 0 ? (
                                                dashboardList.map(dashboard => {
                                                    const id = dashboard.dashboard_id;
                                                    const stringId = String(id);
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
                                        {error && <FormHelperText>{error.message || getIntlText('report.message.select_dashboard')}</FormHelperText>}
                                    </FormControl>
                                );
                            }}
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
