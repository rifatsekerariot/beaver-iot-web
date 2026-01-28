import React from 'react';
import { Typography, Box, Card, CardContent } from '@mui/material';
import { useI18n } from '@milesight/shared/src/hooks';
import { FactCheckIcon } from '@milesight/shared/src/components';

const AlarmRules: React.FC = () => {
    const { getIntlText } = useI18n();
    return (
        <Box sx={{ p: 2 }}>
            <Card variant="outlined" sx={{ maxWidth: 480, mx: 'auto' }}>
                <CardContent sx={{ textAlign: 'center', py: 4, px: 3 }}>
                    <FactCheckIcon sx={{ fontSize: 56, color: 'text.secondary', mb: 2 }} />
                    <Typography variant="h6" gutterBottom color="text.primary">
                        {getIntlText('alarm.tab_rules') || 'Alarm kuralları'}
                    </Typography>
                    <Typography color="text.secondary" sx={{ mb: 1 }}>
                        {getIntlText('alarm.placeholder_rules') || 'Alarm kuralları (if-then) yakında eklenecek.'}
                    </Typography>
                    <Typography variant="body2" color="text.disabled">
                        {getIntlText('alarm.placeholder_rules_phase') || 'Bu özellik Faz 2 kapsamında planlanmaktadır.'}
                    </Typography>
                </CardContent>
            </Card>
        </Box>
    );
};

export default AlarmRules;
