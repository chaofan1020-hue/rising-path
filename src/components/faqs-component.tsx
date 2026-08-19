'use client'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import Link from 'next/link'
import { useLanguage } from '@/lib/language-context'

export default function FAQs() {
    const { t } = useLanguage()

    const faqItems = [
        {
            id: 'item-1',
            questionKey: 'faq1.q',
            answerKey: 'faq1.a',
        },
        {
            id: 'item-2',
            questionKey: 'faq2.q',
            answerKey: 'faq2.a',
        },
        {
            id: 'item-3',
            questionKey: 'faq3.q',
            answerKey: 'faq3.a',
        },
        {
            id: 'item-4',
            questionKey: 'faq4.q',
            answerKey: 'faq4.a',
        },
        {
            id: 'item-5',
            questionKey: 'faq5.q',
            answerKey: 'faq5.a',
        },
    ]

    return (
        <section className="bg-white py-16 md:py-24 rounded-t-[3rem]">
            <div className="mx-auto max-w-5xl px-4 md:px-6">
                <div>
                    <h2 className="text-gray-900 text-2xl md:text-3xl font-semibold">{t("faqs.title")}</h2>
                    <p className="text-gray-500 mt-3 text-balance text-sm md:text-base">{t("faqs.subtitle")}</p>
                </div>

                <div className="mt-12">
                    <Accordion
                        type="single"
                        collapsible
                        className="bg-white ring-gray-200 rounded-lg w-full border border-gray-200 px-8 py-3 shadow ring-1">
                        {faqItems.map((item) => (
                            <AccordionItem
                                key={item.id}
                                value={item.id}
                                className="border-b border-gray-200">
                                <AccordionTrigger className="cursor-pointer text-sm hover:no-underline text-gray-900">{t(item.questionKey)}</AccordionTrigger>
                                <AccordionContent>
                                    <p className="text-sm text-gray-900">{t(item.answerKey)}</p>
                                </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>

                    <p className="text-gray-500 mt-6 text-sm">
                        {t("faqs.contact")}{' '}
                        <Link
                            href="#"
                            className="text-purple-500 font-medium hover:underline">
                            {t("faqs.contactLink")}
                        </Link>
                    </p>
                </div>
            </div>
        </section>
    )
}
