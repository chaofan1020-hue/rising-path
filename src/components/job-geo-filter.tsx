'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

// GET /api/jobs/filters 的返回结构（后端已实现）。页面只拿它渲染筛选器，
// 不参与列表请求的查询参数：country/continent 参数由页面按选中项追加。
export interface JobContinentFacet {
  value: string;
  label: string;
  jobs: number;
  countries: number;
}

export interface JobCountryFacet {
  code: string;
  name: string;
  continent: string;
  jobs: number;
}

export interface JobFilterFacets {
  continents: JobContinentFacet[];
  countries: JobCountryFacet[];
  unplaced: number;
  total: number;
  generated_at: string;
  unavailable?: boolean;
}

type JobGeoFilterProps = {
  facets: JobFilterFacets;
  selectedContinents: string[];
  selectedCountries: string[];
  onContinentsChange: (values: string[]) => void;
  onCountriesChange: (values: string[]) => void;
};

// 大洲 chip + 按大洲分组、可搜索的国家列表。
// 大洲与国家两级互斥：选大洲清空国家，选国家清空大洲（后端对两者是 AND，
// 同时下发会得到空交集，所以界面层保证不会同时选中）。
export function JobGeoFilter({
  facets,
  selectedContinents,
  selectedCountries,
  onContinentsChange,
  onCountriesChange,
}: JobGeoFilterProps) {
  const [search, setSearch] = useState('');

  const normalizedSearch = search.trim().toLowerCase();
  const continentLabels = useMemo(
    () => new Map(facets.continents.map((continent) => [continent.value, continent.label])),
    [facets.continents],
  );

  const matchingCountries = useMemo(() => {
    if (!normalizedSearch) return facets.countries;
    return facets.countries.filter((country) => {
      const label = continentLabels.get(country.continent) ?? country.continent;
      return country.name.toLowerCase().includes(normalizedSearch)
        || country.code.toLowerCase().includes(normalizedSearch)
        || String(label).toLowerCase().includes(normalizedSearch);
    });
  }, [continentLabels, facets.countries, normalizedSearch]);

  // 分组顺序沿用接口给的 continents 顺序（已是产品期望的展示顺序），
  // 未知大洲的条目兜底排在最后。
  const groups = useMemo(() => {
    const buckets = new Map<string, JobCountryFacet[]>();
    for (const country of matchingCountries) {
      const key = country.continent || '';
      const bucket = buckets.get(key);
      if (bucket) bucket.push(country);
      else buckets.set(key, [country]);
    }
    const ordered = facets.continents.map((continent) => continent.value);
    const values = [
      ...ordered.filter((value) => buckets.has(value)),
      ...[...buckets.keys()].filter((value) => !ordered.includes(value)),
    ];
    return values.map((value) => ({
      value,
      label: continentLabels.get(value) ?? (value || '其他'),
      countries: buckets.get(value) ?? [],
    }));
  }, [continentLabels, facets.continents, matchingCountries]);

  const toggleContinent = (value: string) => {
    onContinentsChange(selectedContinents.includes(value)
      ? selectedContinents.filter((item) => item !== value)
      : [...selectedContinents, value]);
  };

  const toggleCountry = (code: string) => {
    onCountriesChange(selectedCountries.includes(code)
      ? selectedCountries.filter((item) => item !== code)
      : [...selectedCountries, code]);
  };

  const hasGeoSelection = selectedContinents.length > 0 || selectedCountries.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={hasGeoSelection ? 'outline' : 'default'}
          aria-pressed={!hasGeoSelection}
          onClick={() => {
            onContinentsChange([]);
            onCountriesChange([]);
          }}
        >
          全部
        </Button>
        {facets.continents.map((continent) => {
          const selected = selectedContinents.includes(continent.value);
          return (
            <Button
              key={continent.value}
              type="button"
              size="sm"
              variant={selected ? 'default' : 'outline'}
              aria-pressed={selected}
              onClick={() => toggleContinent(continent.value)}
            >
              {continent.label}
              <span className="ml-1 text-[11px] opacity-70">{continent.jobs.toLocaleString()}</span>
            </Button>
          );
        })}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索国家或地区"
          className="h-9 border-zinc-200 pl-9 text-sm dark:border-zinc-700"
        />
      </div>

      {groups.length === 0 ? (
        <p className="py-4 text-center text-sm text-zinc-400">没有匹配的国家或地区</p>
      ) : (
        <div className="max-h-60 space-y-3 overflow-y-auto pr-1">
          {groups.map((group) => (
            <div key={group.value} className="space-y-1.5">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{group.label}</p>
              <div className="grid grid-cols-1 gap-1.5">
                {group.countries.map((country) => {
                  const checked = selectedCountries.includes(country.code);
                  return (
                    <label
                      key={country.code}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      translate="no"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleCountry(country.code)}
                      />
                      <span className="min-w-0 flex-1 truncate">{country.name}</span>
                      <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">{country.jobs.toLocaleString()}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {facets.unplaced > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-dashed border-zinc-200 px-3 py-2 text-sm text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
          <span>未归属地区</span>
          <span className="text-xs">{facets.unplaced.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}