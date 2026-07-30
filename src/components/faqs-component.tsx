'use client'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import Link from 'next/link'

export default function FAQs() {
    const faqItems = [
        {
            id: 'item-1',
            question: 'What is Rising Path?',
            answer: 'Rising Path is a one-stop job seeking platform designed for international students, providing job search, AI-powered job matching, resume optimization, and automatic application features to help you land your dream offer.',
        },
        {
            id: 'item-2',
            question: 'How do I use the access code?',
            answer: 'The access code is your credential to enter the platform. Click any feature card on the homepage, enter your access code, and you will be directed to the platform. Each access code corresponds to an independent user space with isolated data.',
        },
        {
            id: 'item-3',
            question: 'How does AI job matching work?',
            answer: 'AI job matching intelligently analyzes your uploaded resume and matches the most suitable positions from our job database, generating match scores, reasons, and targeted optimization suggestions.',
        },
        {
            id: 'item-4',
            question: 'What is ATS resume optimization?',
            answer: 'ATS resume optimization is a feature that optimizes your resume for Applicant Tracking Systems. AI analyzes the target job description and provides targeted resume content optimization to increase your chances of passing ATS screening.',
        },
        {
            id: 'item-5',
            question: 'How do I use the automatic application feature?',
            answer: 'After installing our Chrome browser extension, the extension will automatically fill in your previously saved information when you complete application forms on job websites, greatly simplifying the application process.',
        },
    ]

    return (
        <section className="bg-white py-16 md:py-24">
            <div className="mx-auto max-w-5xl px-4 md:px-6">
                <div>
                    <h2 className="text-gray-900 text-4xl font-semibold">Frequently Asked Questions</h2>
                    <p className="text-gray-600 mt-4 text-balance text-lg">Quick answers to common questions about Rising Path platform</p>
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
                                <AccordionTrigger className="cursor-pointer text-base hover:no-underline text-gray-900">{item.question}</AccordionTrigger>
                                <AccordionContent>
                                    <p className="text-base text-gray-600">{item.answer}</p>
                                </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>

                    <p className="text-gray-600 mt-6">
                        Can't find the answer you're looking for? Contact our{' '}
                        <Link
                            href="#"
                            className="text-purple-500 font-medium hover:underline">
                            customer support team
                        </Link>
                    </p>
                </div>
            </div>
        </section>
    )
}
