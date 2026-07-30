'use client'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import Link from 'next/link'

export default function FAQs() {
    const faqItems = [
        {
            id: 'item-1',
            question: 'Rising Path 是什么？',
            answer: 'Rising Path 是专为海外留学生打造的一站式求职平台，提供岗位查询、AI 智能选岗、简历优化、自动网申等功能，助力海外留学生拿到理想 Offer。',
        },
        {
            id: 'item-2',
            question: '如何使用访问码？',
            answer: '访问码是进入平台的凭证。在首页点击任意功能卡片，输入您的访问码即可进入平台。每个访问码对应独立的用户空间，数据相互隔离。',
        },
        {
            id: 'item-3',
            question: 'AI 智能选岗是如何工作的？',
            answer: 'AI 智能选岗基于您上传的简历进行智能分析，从岗位库中匹配最适合的岗位，生成匹配评分和理由，并提供针对性的优化建议。',
        },
        {
            id: 'item-4',
            question: 'ATS 简历优化是什么？',
            answer: 'ATS 简历优化是针对企业招聘系统（ATS）的简历优化功能。AI 会分析目标岗位的 JD，针对性地优化您的简历内容，提高通过 ATS 筛选的概率。',
        },
        {
            id: 'item-5',
            question: '自动网申功能如何使用？',
            answer: '安装我们的 Chrome 浏览器扩展后，在招聘网站填写网申表单时，扩展会自动填充您之前保存的信息，大大简化网申流程。',
        },
    ]

    return (
        <section className="bg-[#0f0f14] py-16 md:py-24">
            <div className="mx-auto max-w-5xl px-4 md:px-6">
                <div>
                    <h2 className="text-white text-4xl font-semibold">常见问题</h2>
                    <p className="text-gray-400 mt-4 text-balance text-lg">快速了解 Rising Path 平台的功能和使用方法</p>
                </div>

                <div className="mt-12">
                    <Accordion
                        type="single"
                        collapsible
                        className="bg-[#1a1a24] ring-white/5 rounded-lg w-full border border-transparent px-8 py-3 shadow ring-1">
                        {faqItems.map((item) => (
                            <AccordionItem
                                key={item.id}
                                value={item.id}
                                className="border-b border-gray-700">
                                <AccordionTrigger className="cursor-pointer text-base hover:no-underline text-white">{item.question}</AccordionTrigger>
                                <AccordionContent>
                                    <p className="text-base text-gray-400">{item.answer}</p>
                                </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>

                    <p className="text-gray-400 mt-6">
                        没有找到您想要的答案？联系我们的{' '}
                        <Link
                            href="#"
                            className="text-purple-500 font-medium hover:underline">
                            客服团队
                        </Link>
                    </p>
                </div>
            </div>
        </section>
    )
}
