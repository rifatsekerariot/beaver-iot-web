import React, { useState, useCallback, useMemo } from 'react';
import { useForm, Controller, type SubmitHandler } from 'react-hook-form';
import { Box, Button, FormControl, Stack, TextField } from '@mui/material';
import { useRequest } from 'ahooks';
import { useI18n, useTime } from '@milesight/shared/src/hooks';
import { objectToCamelCase } from '@milesight/shared/src/utils/tools';
import { linkDownload, genRandomString } from '@milesight/shared/src/utils/tools';
import { toast } from '@milesight/shared/src/components';
import { DateRangePickerValueType } from '@/components/date-range-picker';
import { DateRangePicker } from '@/components';
import { Breadcrumbs, TablePro, type ColumnType } from '@/components';
import { entityAPI, awaitWrap, getResponseData, isRequestSuccess } from '@/services/http';
import { ENTITY_TYPE } from '@/constants';
import { buildTelemetryPdf, type PdfReportRow } from './utils/pdfReport';

import './style.less';

type FormData = {
    reportTitle?: string;
    companyName?: string;
    dateRange?: DateRangePickerValueType | null;
};

type EntityRow = {
    entityId: ApiKey;
    entityName: string;
    entityKey: string;
    entityValueAttribute?: { unit?: string };
};

export default function ReportPage() {
    const { getIntlText } = useI18n();
    const { dayjs, getTimeFormat, timezone } = useTime();
    const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 20 });
    const [selectedIds, setSelectedIds] = useState<readonly ApiKey[]>([]);
    const [generating, setGenerating] = useState(false);

    const { control, handleSubmit, watch } = useForm<FormData>({ shouldUnregister: true });
    const dateRange = watch('dateRange');

    const {
        data: entityData,
        loading,
        run: fetchEntities,
    } = useRequest(
        async () => {
            const [error, resp] = await awaitWrap(
                entityAPI.advancedSearch({
                    page_size: paginationModel.pageSize,
                    page_number: paginationModel.page + 1,
                    sorts: [{ direction: 'ASC' as const, property: 'key' }],
                    entity_filter: {
                        ENTITY_TYPE: { operator: 'ANY_EQUALS' as const, values: [ENTITY_TYPE.PROPERTY] },
                    },
                }),
            );
            const data = getResponseData(resp);
            if (error || !data || !isRequestSuccess(resp)) return;
            return objectToCamelCase(data);
        },
        { debounceWait: 300, refreshDeps: [paginationModel] },
    );

    const rows = useMemo(() => entityData?.content ?? [], [entityData?.content]);
    const rowId = useCallback((r: EntityRow) => r.entityId, []);

    const columns = useMemo<ColumnType<EntityRow>[]>(
        () => [
            { field: 'entityName', headerName: getIntlText('report.table.entity_name'), flex: 1, minWidth: 160 },
            { field: 'entityKey', headerName: getIntlText('device.label.param_entity_id'), flex: 1, minWidth: 180 },
            {
                field: 'unit',
                headerName: getIntlText('report.table.unit'),
                width: 80,
                valueGetter: (_, row) => row.entityValueAttribute?.unit ?? '—',
            },
        ],
        [getIntlText],
    );

    const onGenerate: SubmitHandler<FormData> = useCallback(
        async ({ reportTitle, companyName, dateRange: dr }) => {
            if (!selectedIds.length) {
                toast.error(getIntlText('report.message.select_at_least_one'));
                return;
            }
            const start = dr?.start?.valueOf();
            const end = dr?.end?.valueOf();
            if (start == null || end == null) {
                toast.error(getIntlText('report.message.select_date_range'));
                return;
            }
            setGenerating(true);
            try {
                const pdfRows: PdfReportRow[] = [];

                for (const entityId of selectedIds) {
                    const entity = rows.find((r: EntityRow) => r.entityId === entityId) as EntityRow | undefined;
                    const name = entity?.entityName ?? String(entityId);
                    const unit = entity?.entityValueAttribute?.unit ?? '';

                    const agg = async (t: 'LAST' | 'MIN' | 'MAX' | 'AVG') => {
                        const [err, resp] = await awaitWrap(
                            entityAPI.getAggregateHistory({
                                entity_id: entityId,
                                start_timestamp: start,
                                end_timestamp: end,
                                aggregate_type: t,
                            }),
                        );
                        const d = !err && isRequestSuccess(resp) ? getResponseData(resp) : null;
                        return d?.value != null ? (typeof d.value === 'number' ? d.value : Number(d.value)) : NaN;
                    };

                    const [last, min, max, avg] = await Promise.all([
                        agg('LAST'),
                        agg('MIN'),
                        agg('MAX'),
                        agg('AVG'),
                    ]);

                    pdfRows.push({ entityName: name, unit, last, min, max, avg });
                }

                const dateRangeStr = `${getTimeFormat(dayjs(start), 'simpleDateFormat')} – ${getTimeFormat(dayjs(end), 'simpleDateFormat')}`;
                const generatedAt = getTimeFormat(dayjs(), 'fullDateTimeSecondFormat');
                const blob = buildTelemetryPdf({
                    title: reportTitle ?? '',
                    companyName: companyName ?? '',
                    dateRange: dateRangeStr,
                    rows: pdfRows,
                    generatedAt,
                    defaultTitle: getIntlText('report.pdf.default_title'),
                    generatedAtLabel: getIntlText('report.pdf.generated_at'),
                    ariotLabel: getIntlText('report.pdf.ariot'),
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
                toast.error(getIntlText('report.message.generate_failed'));
            } finally {
                setGenerating(false);
            }
        },
        [selectedIds, rows, getIntlText, dayjs, getTimeFormat],
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
                            name="reportTitle"
                            control={control}
                            render={({ field }) => (
                                <TextField
                                    {...field}
                                    label={getIntlText('report.form.report_title')}
                                    placeholder={getIntlText('report.form.report_title_placeholder')}
                                    size="small"
                                    sx={{ minWidth: 220 }}
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
                                    />
                                </FormControl>
                            )}
                        />
                        <Button
                            type="submit"
                            variant="contained"
                            disabled={generating || !selectedIds.length}
                            sx={{ height: 40, textTransform: 'none' }}
                        >
                            {generating
                                ? getIntlText('report.form.generate_pdf_loading')
                                : getIntlText('report.form.generate_pdf')}
                        </Button>
                    </Stack>
                </Box>
                <TablePro<EntityRow>
                    tableName="report_entities"
                    columns={columns}
                    rows={rows}
                    getRowId={rowId}
                    rowCount={entityData?.total ?? 0}
                    paginationModel={paginationModel}
                    onPaginationModelChange={setPaginationModel}
                    checkboxSelection
                    rowSelectionModel={selectedIds}
                    onRowSelectionModelChange={setSelectedIds}
                    loading={loading}
                    onRefreshButtonClick={fetchEntities}
                    pageSizeOptions={[10, 20, 50, 100]}
                />
            </div>
        </div>
    );
}
