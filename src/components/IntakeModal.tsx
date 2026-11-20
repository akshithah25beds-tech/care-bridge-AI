import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { evaluateClinicianApprovedRule } from '../core/coordinatorRules';
import { LanguageCode } from '../types/carebridge';

interface IntakeModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: {
    patientName: string;
    age?: number;
    preferredLanguage: LanguageCode;
    screeningType: string;
    screeningValue: string;
    assignedClinician: string;
  }) => Promise<void>;
}

export const IntakeModal: React.FC<IntakeModalProps> = ({ open, onClose, onSubmit }) => {
  const [patientName, setPatientName] = useState('');
  const [age, setAge] = useState('49');
  const [preferredLanguage, setPreferredLanguage] = useState<LanguageCode>('kn');
  const [screeningType, setScreeningType] = useState('HbA1c Metabolic Screening');
  const [screeningValue, setScreeningValue] = useState('7.4% (Clinician Flagged)');
  const [assignedClinician, setAssignedClinician] = useState('Dr. Ananya Rao, MD');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewRule = useMemo(
    () => evaluateClinicianApprovedRule(screeningType, screeningValue),
    [screeningType, screeningValue]
  );

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!patientName.trim() || !screeningType.trim() || !screeningValue.trim()) {
      setError('Please enter patient name, screening type, and screening summary.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        patientName: patientName.trim(),
        age: age ? Number(age) : undefined,
        preferredLanguage,
        screeningType: screeningType.trim(),
        screeningValue: screeningValue.trim(),
        assignedClinician: assignedClinician.trim() || 'Dr. Ananya Rao, MD',
      });
      setPatientName('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit intake.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="intake-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl max-w-xl w-full p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <h2 id="intake-modal-title" className="font-display text-lg font-semibold text-slate-900">
              Agent 1: Result Intake & Protocol Mapping
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Fictional screening intake using clinician-approved coordination rules (never diagnoses).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close intake modal"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="intake-patient-name" className="block text-xs font-medium text-slate-700 mb-1">
                Patient Name (Fictional)
              </label>
              <input
                id="intake-patient-name"
                type="text"
                required
                placeholder="e.g., Meena Kumari"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700"
              />
            </div>

            <div>
              <label htmlFor="intake-age" className="block text-xs font-medium text-slate-700 mb-1">
                Age
              </label>
              <input
                id="intake-age"
                type="number"
                min={1}
                max={120}
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 font-mono-tabular"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="intake-language" className="block text-xs font-medium text-slate-700 mb-1">
                Preferred Voice Language
              </label>
              <select
                id="intake-language"
                value={preferredLanguage}
                onChange={(e) => setPreferredLanguage(e.target.value as LanguageCode)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700"
              >
                <option value="kn">Kannada (ಕನ್ನಡ)</option>
                <option value="en">English</option>
              </select>
            </div>

            <div>
              <label htmlFor="intake-clinician" className="block text-xs font-medium text-slate-700 mb-1">
                Supervising Clinician
              </label>
              <input
                id="intake-clinician"
                type="text"
                value={assignedClinician}
                onChange={(e) => setAssignedClinician(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="intake-screening-type" className="block text-xs font-medium text-slate-700 mb-1">
                Screening Type
              </label>
              <select
                id="intake-screening-type"
                value={screeningType}
                onChange={(e) => setScreeningType(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700"
              >
                <option value="HbA1c Metabolic Screening">HbA1c Metabolic Screening</option>
                <option value="Blood Pressure Screening">Blood Pressure Screening</option>
                <option value="Mammography Screening">Mammography Screening</option>
                <option value="Lipid Panel Screening">Lipid Panel Screening</option>
              </select>
            </div>

            <div>
              <label htmlFor="intake-screening-value" className="block text-xs font-medium text-slate-700 mb-1">
                Screening Entry / Flag
              </label>
              <input
                id="intake-screening-value"
                type="text"
                required
                value={screeningValue}
                onChange={(e) => setScreeningValue(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700"
              />
            </div>
          </div>

          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700">Clinician-Approved Rule Preview</span>
              <span className="font-mono-tabular text-teal-700">{previewRule.followUpCategory}</span>
            </div>
            <p className="text-xs font-medium text-slate-800">{previewRule.clinicianProtocol}</p>
            <p className="text-xs text-slate-600">
              {preferredLanguage === 'kn'
                ? previewRule.clinicianApprovedSummaryKn
                : previewRule.clinicianApprovedSummaryEn}
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg transition-colors"
            >
              {submitting ? 'Creating Case...' : 'Create Patient Case'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
