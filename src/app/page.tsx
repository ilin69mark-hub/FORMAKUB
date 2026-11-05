import type { Metadata } from "next";
import { Hero } from "@/components/site/Hero";
import { ValueMarquee } from "@/components/site/ValueMarquee";
import { CategoryGrid } from "@/components/site/CategoryGrid";
import { MiniConfigurator } from "@/components/site/MiniConfigurator";
import { Process } from "@/components/site/Process";
import { ProjectsShowcase } from "@/components/site/ProjectsShowcase";
import { Advantages } from "@/components/site/Advantages";
import { ReviewsSection } from "@/components/site/ReviewsSection";
import { PromotionsSection } from "@/components/site/PromotionsSection";
import { PaymentDelivery } from "@/components/site/PaymentDelivery";
import { Faq } from "@/components/site/Faq";
import { FinalCta } from "@/components/site/FinalCta";
import { FAQ_ITEMS } from "@/content/faq";
import { SITE } from "@/content/site";

export const metadata: Metadata = {
  title: "Кухни и корпусная мебель на заказ по индивидуальным размерам",
  description:
    "Соберите кухню или шкаф в 2D-конфигураторе FORMAKUB: размеры, фасады, наполнение и предварительная стоимость. Заявка без онлайн-оплаты.",
  alternates: { canonical: "/" },
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "@id": `${SITE.url}/#faq`,
  mainEntity: FAQ_ITEMS.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.a,
    },
  })),
};

export default function HomePage() {
  return (
    <>
      <Hero />
      <ValueMarquee />
      <CategoryGrid />
      <MiniConfigurator />
      <Process />
      <ProjectsShowcase />
      <Advantages />
      <ReviewsSection />
      <PromotionsSection />
      <PaymentDelivery />
      <Faq />
      <FinalCta />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
    </>
  );
}
